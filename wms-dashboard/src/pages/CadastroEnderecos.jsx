import { useState } from 'react';
import { api } from '../api';

export default function CadastroEnderecos() {
    const [rack, setRack] = useState('1');
    const [predios, setPredios] = useState('A,B,C,D,E');
    const [andares, setAndares] = useState('2,3,4,5');
    const [posicoes, setPosicoes] = useState('P01,P02,P03,P04');
    const [resultado, setResultado] = useState(null);
    const [enviando, setEnviando] = useState(false);

    async function gerar() {
        setEnviando(true);
        setResultado(null);
        try {
            const resposta = await api.post('/cadastro-enderecos/gerar-lote', {
                rack,
                predios: predios.split(',').map((v) => v.trim()).filter(Boolean),
                andares: andares.split(',').map((v) => Number(v.trim())).filter(Boolean),
                posicoes: posicoes.split(',').map((v) => v.trim()).filter(Boolean),
            });
            setResultado(resposta);
        } catch (e) {
            setResultado({ erro: e.message });
        } finally {
            setEnviando(false);
        }
    }

    const totalPrevisto =
        predios.split(',').filter(Boolean).length *
        andares.split(',').filter(Boolean).length *
        posicoes.split(',').filter(Boolean).length;

    return (
        <div>
            <h2 style={{ fontSize: 20, marginBottom: '0.5rem' }}>Cadastro de endereços do vertical</h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
                Gera todas as combinações de prédio × andar × posição de uma vez, em vez de
                cadastrar endereço por endereço. Rode isso uma vez, no começo, pra montar o mapa
                de ruas inteiro.
            </p>

            <div className="card" style={{ maxWidth: 480 }}>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Rack</label>
                <input type="text" value={rack} onChange={(e) => setRack(e.target.value)} style={{ width: '100%', margin: '4px 0 10px' }} />

                <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Prédios (separados por vírgula)</label>
                <input type="text" value={predios} onChange={(e) => setPredios(e.target.value)} style={{ width: '100%', margin: '4px 0 10px' }} />

                <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Andares (separados por vírgula)</label>
                <input type="text" value={andares} onChange={(e) => setAndares(e.target.value)} style={{ width: '100%', margin: '4px 0 10px' }} />

                <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Posições (separadas por vírgula)</label>
                <input type="text" value={posicoes} onChange={(e) => setPosicoes(e.target.value)} style={{ width: '100%', margin: '4px 0 12px' }} />

                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                    Isso vai gerar até {totalPrevisto} endereços (códigos repetidos são ignorados
                    automaticamente, então é seguro rodar de novo se precisar completar depois).
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
