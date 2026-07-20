import { useState } from 'react';
import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../api';

const RUAS = ['1 - COBRE', '2 - LATÃO', '3 - TITÂNIO', '4 - AÇO', '5 - FERRO', '6 - INOX', '7 - ALUMÍNIO'];

export default function CadastroEnderecos() {
    const [rua, setRua] = useState(RUAS[0]);
    const [predios, setPredios] = useState('A,B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,Q,R,S,T');
    const [andares, setAndares] = useState('1,2,3,4,5');
    const [resultado, setResultado] = useState(null);
    const [enviando, setEnviando] = useState(false);

    const [ruaQr, setRuaQr] = useState(RUAS[0]);
    const [enderecosQr, setEnderecosQr] = useState([]);
    const [carregandoQr, setCarregandoQr] = useState(false);

    async function gerar() {
        setEnviando(true);
        setResultado(null);
        try {
            const resposta = await api.post('/cadastro-enderecos/gerar-lote', {
                rua,
                predios: predios.split(',').map((v) => v.trim()).filter(Boolean),
                andares: andares.split(',').map((v) => Number(v.trim())).filter(Boolean),
            });
            setResultado(resposta);
        } catch (e) {
            setResultado({ erro: e.message });
        } finally {
            setEnviando(false);
        }
    }

    const totalPrevisto =
        predios.split(',').filter(Boolean).length * andares.split(',').filter(Boolean).length;

    async function carregarQrDaRua() {
        setCarregandoQr(true);
        try {
            const mapa = await api.get('/enderecos/mapa');
            setEnderecosQr(
                mapa
                    .filter((e) => e.rua === ruaQr)
                    .sort((a, b) => a.andar - b.andar)
            );
        } finally {
            setCarregandoQr(false);
        }
    }

    // Agrupa por prédio - uma etiqueta por prédio, com os andares
    // (1 ao 5) juntos dentro dela, em vez de uma etiqueta separada
    // pra cada posição individual.
    const gruposPorPredio = enderecosQr.reduce((grupos, e) => {
        (grupos[e.predio] ||= []).push(e);
        return grupos;
    }, {});
    const prediosComQr = Object.keys(gruposPorPredio).sort();

    function imprimirQr() {
        window.print();
    }

    return (
        <div>
            <h2 style={{ fontSize: 20, marginBottom: '0.5rem' }}>Cadastro de endereços do vertical</h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
                Endereço = rua × prédio (posição horizontal) × andar (posição vertical). O endereço é
                genérico — qualquer depósito (Máquinas, Avarias, Verde, Vermelho, Amarelo) pode ser
                guardado em qualquer posição; isso é decidido na hora do recebimento, não aqui. Rode
                isso uma vez pra cada rua.
            </p>

            <div className="card" style={{ maxWidth: 480 }}>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Rua</label>
                <select value={rua} onChange={(e) => setRua(e.target.value)} style={{ width: '100%', margin: '4px 0 10px' }}>
                    {RUAS.map((r) => (
                        <option key={r} value={r}>{r}</option>
                    ))}
                </select>

                <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    Prédios / posições horizontais (separados por vírgula)
                </label>
                <input type="text" value={predios} onChange={(e) => setPredios(e.target.value)} style={{ width: '100%', margin: '4px 0 10px' }} />

                <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    Andares / posições verticais (separados por vírgula)
                </label>
                <input type="text" value={andares} onChange={(e) => setAndares(e.target.value)} style={{ width: '100%', margin: '4px 0 12px' }} />

                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                    Isso vai gerar até {totalPrevisto} endereços na rua "{rua}" (códigos repetidos são
                    ignorados automaticamente, seguro rodar de novo).
                </p>

                <button className="primary" style={{ width: '100%' }} disabled={enviando} onClick={gerar}>
                    {enviando ? 'Gerando...' : 'Gerar endereços'}
                </button>

                {resultado?.erro && <p style={{ fontSize: 13, color: 'var(--danger-text)', marginTop: 12 }}>{resultado.erro}</p>}
                {resultado && !resultado.erro && (
                    <p style={{ fontSize: 13, marginTop: 12 }}>
                        {resultado.criados} endereço(s) criado(s), {resultado.ignorados} já existiam e foram ignorados.
                    </p>
                )}
            </div>

            <h2 style={{ fontSize: 20, margin: '2rem 0 0.5rem' }}>QR Code dos endereços</h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                Etiqueta pra fixar na prateleira, com QR Code do código do endereço. Isso resolve o
                problema de bipar "qualquer coisa" (tipo o código de um pallet) no lugar do endereço
                de verdade - o sistema passa a validar contra o que está realmente bipado.
            </p>

            <div className="card" style={{ maxWidth: 480, marginBottom: '1.5rem' }}>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Rua</label>
                <select value={ruaQr} onChange={(e) => setRuaQr(e.target.value)} style={{ width: '100%', margin: '4px 0 10px' }}>
                    {RUAS.map((r) => (
                        <option key={r} value={r}>{r}</option>
                    ))}
                </select>
                <button className="primary" style={{ width: '100%' }} disabled={carregandoQr} onClick={carregarQrDaRua}>
                    {carregandoQr ? 'Carregando...' : 'Carregar endereços dessa rua'}
                </button>
            </div>

            {enderecosQr.length > 0 && (
                <>
                    <p style={{ fontSize: 13, marginBottom: 8 }}>
                        {enderecosQr.length} endereço(s) em {prediosComQr.length} prédio(s) da rua "{ruaQr}".
                    </p>
                    <button className="no-print" style={{ marginBottom: 12 }} onClick={imprimirQr}>
                        Imprimir essas etiquetas
                    </button>

                    <div className="grade-qr-enderecos">
                        {prediosComQr.map((predio) => (
                            <div key={predio} className="etiqueta-predio">
                                <p className="etiqueta-predio-titulo">Prédio {predio}</p>
                                {gruposPorPredio[predio].map((e) => (
                                    <div key={e.id} className="etiqueta-andar-linha">
                                        <QRCodeSVG value={e.codigo} size={44} />
                                        <span>{e.codigo}</span>
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>

                    {document.getElementById('print-root') && createPortal(
                        <div className="grade-qr-enderecos">
                            {prediosComQr.map((predio) => (
                                <div key={predio} className="etiqueta-predio">
                                    <p className="etiqueta-predio-titulo">Prédio {predio}</p>
                                    {gruposPorPredio[predio].map((e) => (
                                        <div key={e.id} className="etiqueta-andar-linha">
                                            <QRCodeSVG value={e.codigo} size={44} />
                                            <span>{e.codigo}</span>
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>,
                        document.getElementById('print-root')
                    )}
                </>
            )}
        </div>
    );
}
