import { useState } from 'react';
import { api } from '../api';

const RUAS = ['1 - COBRE', '2 - LATÃO', '3 - TITÂNIO', '4 - AÇO', '5 - FERRO', '6 - INOX', '7 - ALUMÍNIO'];

export default function CadastroEnderecos() {
    const [rua, setRua] = useState(RUAS[0]);
    const [predios, setPredios] = useState('A,B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,Q,R,S,T');
    const [andares, setAndares] = useState('1,2,3,4,5');
    const [resultado, setResultado] = useState(null);
    const [enviando, setEnviando] = useState(false);

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
        </div>
    );
}
