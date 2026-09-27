import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import BipagemInput from '../components/BipagemInput.jsx';

// Transferência de Depósito (16/09/2026)
// Bipagem livre pra reserva fixa de transferência pro depósito de
// marketplace (Mercado Livre) - reserva 22919 no ZenERP, que fica
// sempre "iniciada" lá (nunca finalizada por aqui). Diferente da
// Separação, não existe uma lista prévia de itens esperados: o
// colaborador bipa qualquer unidade serializada que for de fato sair
// pra esse depósito, uma de cada vez - o backend cuida de alocar no
// Zen e dar baixa aqui no WMS.
//
// CORREÇÃO 17/09/2026: acrescentados os depósitos Showroom e
// Assistência Técnica, a pedido do Dhiefferton. Escolhe-se o destino
// UMA vez no dropdown acima da bipagem (fica valendo pra toda bipagem
// seguinte, até trocar de novo) - ver DESTINOS em
// wms-api/routes/transferencia-deposito.js pro porquê dos três caírem
// na mesma reserva do Zen por enquanto.
//
// CORREÇÃO 21/09/2026: acrescentado o depósito Almoxarifado, mesma
// reserva fixa dos outros três (ver DESTINOS no arquivo da API).
//
// CORREÇÃO 27/09/2026: acrescentado o depósito Engenharia, mesma
// reserva fixa dos demais.
const DESTINOS = [
    { valor: 'mercado_livre', label: 'Mercado Livre' },
    { valor: 'showroom', label: 'Showroom' },
    { valor: 'assistencia_tecnica', label: 'Assistência Técnica' },
    { valor: 'almoxarifado', label: 'Almoxarifado' },
    { valor: 'engenharia', label: 'Engenharia' },
];

// CORREÇÃO 27/09/2026: mecanismo de retorno, a pedido do Dhiefferton
// ("criar o mecanismo de voltar o item para o local de onde saiu lá
// do picking e de onde seja") - quando um item que tinha saído por
// aqui volta fisicamente, o modo "Retorno" reativa a unidade e devolve
// ela pro picking (posição fixa do SKU), sem precisar escolher
// depósito nenhum (é sempre a mesma pergunta: "esse serial já saiu
// por essa tela?"). Ver POST /transferencia-deposito/retornar
// (wms-api/routes/transferencia-deposito.js) pro porquê de sempre ir
// pro picking e não tentar reconstituir o local exato de origem, e
// pro aviso de que a reserva fixa 22919 do ZenERP NÃO é desalocada
// automaticamente por esse modo (ajuste lá é manual, por enquanto).
const MODOS = [
    { valor: 'saida', label: 'Saída' },
    { valor: 'retorno', label: 'Retorno' },
];

export default function TransferenciaDeposito() {
    const navigate = useNavigate();
    const [modo, setModo] = useState('saida');
    const [destino, setDestino] = useState('mercado_livre');
    const [processando, setProcessando] = useState(false);
    const [erro, setErro] = useState(null);
    const [ultimoResultado, setUltimoResultado] = useState(null);
    const [historico, setHistorico] = useState([]);
    // Contador separado da lista exibida: o histórico visível fica limitado
    // às últimas 20 bipagens (senão a tela cresce sem fim numa sessão longa),
    // mas o contador no rótulo precisa continuar subindo de verdade mesmo
    // depois da lista já ter estourado esse limite - por isso não usa mais
    // historico.length (que trava em 20 pra sempre).
    const [totalSessao, setTotalSessao] = useState(0);

    function trocarModo(novoModo) {
        setModo(novoModo);
        setErro(null);
        setUltimoResultado(null);
    }

    async function biparSerial(codigo) {
        setProcessando(true);
        setErro(null);
        try {
            const resposta = modo === 'retorno'
                ? await api.post('/transferencia-deposito/retornar', { serial: codigo })
                : await api.post('/transferencia-deposito/bipar', { serial: codigo, destino });
            const registro = { ...resposta, modo };
            setUltimoResultado(registro);
            setHistorico((atual) => [registro, ...atual].slice(0, 20));
            setTotalSessao((atual) => atual + 1);
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
                <span className="badge accent">Transferência de Depósito</span>
            </div>

            <div className="card" style={{ display: 'flex', gap: 8 }}>
                {MODOS.map((m) => (
                    <button
                        key={m.valor}
                        className={modo === m.valor ? 'primary' : ''}
                        style={{ flex: 1 }}
                        onClick={() => trocarModo(m.valor)}
                    >
                        {m.label}
                    </button>
                ))}
            </div>

            {modo === 'saida' ? (
                <div className="card">
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: 'var(--text-secondary)' }}>
                        Depósito de destino
                        <select value={destino} onChange={(e) => setDestino(e.target.value)} style={{ width: '100%' }}>
                            {DESTINOS.map((d) => (
                                <option key={d.valor} value={d.valor}>{d.label}</option>
                            ))}
                        </select>
                    </label>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '10px 0 0' }}>
                        Bipe o número de série de cada unidade que vai sair pro depósito escolhido acima.
                        Não tem lista prévia - bipa livremente, uma unidade por vez.
                    </p>
                </div>
            ) : (
                <div className="card">
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                        Bipe o número de série de uma unidade que já tinha saído por essa tela e voltou fisicamente.
                        Ela volta pra posição de picking (flutuante) reservada pro SKU dela - a reserva fixa no ZenERP
                        não é ajustada automaticamente, isso continua manual por enquanto.
                    </p>
                </div>
            )}

            {ultimoResultado && (
                <div className="card" style={{ background: 'var(--success-bg)' }}>
                    <p style={{ fontSize: 11, color: 'var(--success-text)' }}>
                        {ultimoResultado.modo === 'retorno' ? 'Devolvido ao picking' : `Transferido · ${ultimoResultado.destino}`}
                    </p>
                    <p style={{ fontSize: 18, fontWeight: 600, color: 'var(--success-text)' }}>{ultimoResultado.produto}</p>
                    <p style={{ fontSize: 13, color: 'var(--success-text)' }}>Serial {ultimoResultado.numeroSerie}</p>
                    {ultimoResultado.modo === 'retorno' && (
                        <p style={{ fontSize: 12, color: 'var(--success-text)' }}>Posição {ultimoResultado.enderecoPickingCodigo}</p>
                    )}
                </div>
            )}

            <BipagemInput label="Bipar número de série" onBipar={biparSerial} />
            {processando && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{modo === 'retorno' ? 'Devolvendo...' : 'Transferindo...'}</p>}
            {erro && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erro}</p>}

            {historico.length > 0 && (
                <div className="card" style={{ marginTop: 'auto' }}>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                        Bipados nessa sessão ({totalSessao}){historico.length < totalSessao ? ' · mostrando os últimos 20' : ''}
                    </p>
                    {historico.map((item, i) => (
                        <p key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '2px 0' }}>
                            {item.produto} · {item.numeroSerie} · {item.modo === 'retorno' ? `Devolvido (${item.enderecoPickingCodigo})` : item.destino}
                        </p>
                    ))}
                </div>
            )}
        </div>
    );
}
