import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import BipagemInput from '../components/BipagemInput.jsx';

// Estoque Devolução (26/09/2026)
// Etapas 2 e 3 do fluxo novo de devolução pra produto SERIALIZADO (a
// etapa 1 - a nota confirma e a peça "boa" cai numa das 4 posições
// fixas - acontece sozinha em NfDevolucao.jsx / nf-devolucao.js). As 4
// posições (R1-A-A1, R1-B-A1, R1-C-A1, R1-D-A1) ficam sempre
// reservadas pra isso, mesmo vazias (ver mapa de ruas).
//
// Aqui o colaborador faz, pra cada posição ocupada:
//   1. Escolhe o depósito final (Máquinas/Verde/Amarelo/Vermelho/
//      Avarias) - a mesma triagem bom/defeituoso já feita na nota não
//      muda, isso é ALÉM dela.
//   2. Depois de definido o depósito, bipa cada etiqueta (número de
//      série) da posição - o backend aloca na reserva 22919 do ZenERP
//      (mesma da Transferência de Depósito) e move a unidade pro
//      picking do WMS (ela continua disponível pra separação, não sai
//      do estoque como na Transferência de Depósito).
export default function EstoqueDevolucao() {
    const navigate = useNavigate();
    const [posicoes, setPosicoes] = useState([]);
    const [carregando, setCarregando] = useState(true);
    const [erro, setErro] = useState(null);
    const [salvandoDeposito, setSalvandoDeposito] = useState(null);
    const [depositoEscolhido, setDepositoEscolhido] = useState({});
    const [bipando, setBipando] = useState(false);
    const [ultimoBipado, setUltimoBipado] = useState(null);

    const DEPOSITOS = ['Maquinas', 'Verde', 'Amarelo', 'Vermelho', 'Avarias'];

    function carregar() {
        setCarregando(true);
        api
            .get('/devolucao-estoque')
            .then(setPosicoes)
            .catch((e) => setErro(e.message))
            .finally(() => setCarregando(false));
    }

    // CORRIGIDO (25/09/2026, a pedido do Dhiefferton - "a cada bipe a
    // tela fica carregando, trave isso pra eu poder bipar em
    // sequência"): antes, definirDeposito/biparSerial chamavam
    // carregar() depois de cada ação - isso jogava carregando=true, e
    // com carregando=true a tela INTEIRA (lista de posições + o campo
    // de bipagem, BipagemInput) sumia e virava só "Carregando...".
    // Cada bipe bem-sucedido derrubava o campo de bipagem da tela por
    // uma fração de segundo - suficiente pra atrapalhar quem bipa em
    // sequência rápida com o leitor físico (o campo perde o foco/some
    // e volta, e o próximo bipe pode chegar nesse intervalo). Essa
    // função atualiza as posições SEM esconder a tela - carregando só
    // é usado no carregamento inicial.
    function atualizarPosicoes() {
        return api
            .get('/devolucao-estoque')
            .then(setPosicoes)
            .catch((e) => setErro(e.message));
    }

    useEffect(carregar, []);

    async function definirDeposito(palletId) {
        const deposito = depositoEscolhido[palletId];
        if (!deposito) return;
        setSalvandoDeposito(palletId);
        setErro(null);
        try {
            await api.patch(`/devolucao-estoque/${palletId}/deposito`, { deposito });
            await atualizarPosicoes();
        } catch (e) {
            setErro(e.message);
        } finally {
            setSalvandoDeposito(null);
        }
    }

    async function biparSerial(codigo) {
        setBipando(true);
        setErro(null);
        try {
            const resposta = await api.post('/devolucao-estoque/bipar', { serial: codigo });
            setUltimoBipado(resposta);
            await atualizarPosicoes();
        } catch (e) {
            setErro(e.message);
        } finally {
            setBipando(false);
        }
    }

    if (carregando) {
        return (
            <div className="tela">
                <p style={{ color: 'var(--text-muted)' }}>Carregando...</p>
            </div>
        );
    }

    const ocupadas = posicoes.filter((p) => p.pallet_id);
    const temAlgumaPendenteDeDeposito = ocupadas.some((p) => !p.deposito);

    return (
        <div className="tela">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button onClick={() => navigate('/')}>←</button>
                <span className="badge accent">Estoque Devolução</span>
            </div>

            {posicoes.map((pos) => (
                <div key={pos.endereco_id} className="card">
                    <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{pos.codigo}</p>
                    {pos.pallet_id ? (
                        <>
                            <p style={{ fontSize: 16, fontWeight: 600 }}>{pos.sku}</p>
                            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{pos.descricao}</p>
                            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{pos.quantidade} un.</p>
                            {pos.deposito ? (
                                <p style={{ fontSize: 13, color: 'var(--success-text)', marginTop: 4 }}>
                                    Depósito definido: {pos.deposito} - pode bipar as etiquetas abaixo
                                </p>
                            ) : (
                                <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
                                    <select
                                        value={depositoEscolhido[pos.pallet_id] || ''}
                                        onChange={(e) =>
                                            setDepositoEscolhido((atual) => ({ ...atual, [pos.pallet_id]: e.target.value }))
                                        }
                                        style={{ flex: 1 }}
                                    >
                                        <option value="">Escolha o depósito...</option>
                                        {DEPOSITOS.map((d) => (
                                            <option key={d} value={d}>{d}</option>
                                        ))}
                                    </select>
                                    <button
                                        disabled={!depositoEscolhido[pos.pallet_id] || salvandoDeposito === pos.pallet_id}
                                        onClick={() => definirDeposito(pos.pallet_id)}
                                    >
                                        {salvandoDeposito === pos.pallet_id ? 'Salvando...' : 'Definir'}
                                    </button>
                                </div>
                            )}
                        </>
                    ) : (
                        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Livre</p>
                    )}
                </div>
            ))}

            {ultimoBipado && (
                <div className="card" style={{ background: 'var(--success-bg)' }}>
                    <p style={{ fontSize: 11, color: 'var(--success-text)' }}>Bipado e alocado no Zen (reserva {ultimoBipado.reservaZen})</p>
                    <p style={{ fontSize: 18, fontWeight: 600, color: 'var(--success-text)' }}>{ultimoBipado.produto}</p>
                    <p style={{ fontSize: 13, color: 'var(--success-text)' }}>
                        Serial {ultimoBipado.numeroSerie} · {ultimoBipado.deposito} → picking {ultimoBipado.enderecoPickingCodigo}
                    </p>
                </div>
            )}

            {ocupadas.length > 0 && (
                <>
                    <BipagemInput label="Bipar número de série" onBipar={biparSerial} />
                    {bipando && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Processando...</p>}
                    {temAlgumaPendenteDeDeposito && (
                        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            Posições sem depósito definido ainda não podem ser bipadas.
                        </p>
                    )}
                </>
            )}

            {erro && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erro}</p>}
        </div>
    );
}
