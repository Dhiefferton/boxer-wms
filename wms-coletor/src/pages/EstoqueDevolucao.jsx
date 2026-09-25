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
// Aqui o colaborador faz, pra cada SKU dentro de cada posição ocupada:
//   1. Escolhe o depósito final (Máquinas/Verde/Amarelo/Vermelho/
//      Avarias) - a mesma triagem bom/defeituoso já feita na nota não
//      muda, isso é ALÉM dela.
//   2. Depois de definido o depósito, bipa cada etiqueta (número de
//      série) da posição - o backend aloca na reserva 22919 do ZenERP
//      (mesma da Transferência de Depósito) e move a unidade pro
//      picking do WMS (ela continua disponível pra separação, não sai
//      do estoque como na Transferência de Depósito).
//
// CORRIGIDO (25/09/2026, a pedido do Dhiefferton - "Todas posições do
// estoque devolução, pode aceitar até 10 sku diferentes"): cada
// posição deixou de guardar só 1 SKU por vez - `GET /devolucao-estoque`
// agora devolve `pallets: [...]` por posição (até 10 SKUs diferentes
// cada). A UI precisou virar uma lista de SKUs DENTRO de cada card de
// posição, em vez de 1 SKU por card.
const LIMITE_SKUS_POR_POSICAO = 10;
export default function EstoqueDevolucao() {
    const navigate = useNavigate();
    const [posicoes, setPosicoes] = useState([]);
    const [carregando, setCarregando] = useState(true);
    const [erro, setErro] = useState(null);
    const [salvandoDeposito, setSalvandoDeposito] = useState(null);
    const [depositoEscolhido, setDepositoEscolhido] = useState({});
    const [bipando, setBipando] = useState(false);
    const [ultimoBipado, setUltimoBipado] = useState(null);
    // CORRIGIDO (25/09/2026, a pedido do Dhiefferton - achado real: devolução
    // nunca dá entrada formal no estoque do Zen, só "empresta" saldo livre já
    // existente na área MAQ na hora de bipar; quando esse saldo emprestado
    // acaba, o Zen recusa com "sem estoque disponível" - ver comentário no
    // topo de devolucao-estoque.js). Erro de bipagem tem estado PRÓPRIO
    // (erroBipagem), separado do erro genérico (erro, usado por ex. quando
    // falha ao definir depósito): enquanto erroBipagem estiver preenchido, a
    // tela trava a bipagem (desabilita o BipagemInput) e mostra um cartão
    // vermelho bem visível - sem isso, quem bipa rápido em sequência podia
    // nem notar a mensagem de erro pequena lá embaixo e continuar tentando
    // bipar sem saber que aquele serial não foi processado.
    const [erroBipagem, setErroBipagem] = useState(null);

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
        try {
            const resposta = await api.post('/devolucao-estoque/bipar', { serial: codigo });
            setUltimoBipado(resposta);
            setErroBipagem(null);
            await atualizarPosicoes();
        } catch (e) {
            // Trava a bipagem (BipagemInput fica desabilitado - ver JSX)
            // até o colaborador confirmar que viu a mensagem, em vez de só
            // mostrar um texto pequeno que pode passar despercebido.
            setErroBipagem(e.message);
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

    // Cada posição agora pode ter vários pallets (SKUs) - achata tudo
    // numa lista só pra decidir se mostra o campo de bipagem e quais
    // SKUs ainda faltam depósito, independente de em qual posição estão.
    const todosPallets = posicoes.flatMap((pos) =>
        (pos.pallets || []).map((pallet) => ({ ...pallet, posicaoCodigo: pos.codigo }))
    );
    const pendentesDeDeposito = todosPallets.filter((p) => !p.deposito);

    return (
        <div className="tela">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button onClick={() => navigate('/')}>←</button>
                <span className="badge accent">Estoque Devolução</span>
            </div>

            {posicoes.map((pos) => (
                <div key={pos.endereco_id} className="card">
                    <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {pos.codigo} · {(pos.pallets || []).length}/{LIMITE_SKUS_POR_POSICAO} SKUs
                    </p>
                    {(pos.pallets || []).length === 0 ? (
                        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Livre</p>
                    ) : (
                        pos.pallets.map((pallet, i) => (
                            <div
                                key={pallet.pallet_id}
                                style={i > 0 ? { marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' } : undefined}
                            >
                                <p style={{ fontSize: 16, fontWeight: 600 }}>{pallet.sku}</p>
                                <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{pallet.descricao}</p>
                                <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{pallet.quantidade} un.</p>
                                {pallet.deposito ? (
                                    <p style={{ fontSize: 13, color: 'var(--success-text)', marginTop: 4 }}>
                                        Depósito definido: {pallet.deposito} - pode bipar as etiquetas abaixo
                                    </p>
                                ) : (
                                    <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
                                        <select
                                            value={depositoEscolhido[pallet.pallet_id] || ''}
                                            onChange={(e) =>
                                                setDepositoEscolhido((atual) => ({ ...atual, [pallet.pallet_id]: e.target.value }))
                                            }
                                            style={{ flex: 1 }}
                                        >
                                            <option value="">Escolha o depósito...</option>
                                            {DEPOSITOS.map((d) => (
                                                <option key={d} value={d}>{d}</option>
                                            ))}
                                        </select>
                                        <button
                                            disabled={!depositoEscolhido[pallet.pallet_id] || salvandoDeposito === pallet.pallet_id}
                                            onClick={() => definirDeposito(pallet.pallet_id)}
                                        >
                                            {salvandoDeposito === pallet.pallet_id ? 'Salvando...' : 'Definir'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))
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

            {erroBipagem && (
                <div className="card" style={{ background: 'var(--danger-bg)', border: '2px solid var(--danger-text)' }}>
                    <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--danger-text)' }}>⚠ Não foi possível bipar</p>
                    <p style={{ fontSize: 14, color: 'var(--danger-text)' }}>{erroBipagem}</p>
                    <button style={{ marginTop: 8 }} onClick={() => setErroBipagem(null)}>
                        Entendi, continuar bipando
                    </button>
                </div>
            )}

            {todosPallets.length > 0 && (
                <>
                    <BipagemInput label="Bipar número de série" onBipar={biparSerial} disabled={!!erroBipagem} />
                    {bipando && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Processando...</p>}
                    {/* CORRIGIDO (25/09/2026, a pedido do Dhiefferton): a mensagem antiga
                        ("Posições sem depósito definido ainda não podem ser bipadas") dava a
                        entender que NENHUMA bipagem era possível enquanto qualquer posição
                        estivesse sem depósito - mas o campo de bipagem é único e compartilhado
                        pra todas as posições ocupadas, e o backend só bloqueia a bipagem da(s)
                        posição(ões) realmente sem depósito. Agora a mensagem nomeia só as
                        posições pendentes e deixa claro que as demais podem ser bipadas normal. */}
                    {pendentesDeDeposito.length > 0 && (
                        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {pendentesDeDeposito.map((p) => `${p.posicaoCodigo} · ${p.sku}`).join(', ')}
                            {pendentesDeDeposito.length > 1 ? ' ainda não têm' : ' ainda não tem'} depósito definido e
                            não pode{pendentesDeDeposito.length > 1 ? 'm' : ''} ser bipada
                            {pendentesDeDeposito.length > 1 ? 's' : ''} ainda - as demais posições podem ser
                            bipadas normalmente.
                        </p>
                    )}
                </>
            )}

            {erro && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erro}</p>}
        </div>
    );
}
