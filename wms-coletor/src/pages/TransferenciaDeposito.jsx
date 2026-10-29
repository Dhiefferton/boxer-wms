import { useState, useRef } from 'react';
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
    // 15/10/2026: Verde/Amarelo/Vermelho/Avarias - só pra serial que já saiu por transferência; a unidade
    // volta pro picking com a marca do depósito (igual ao Estoque Devolução). Ver transferirParaDepositoProprio
    // em wms-api/routes/transferencia-deposito.js.
    { valor: 'verde', label: 'Verde', proprio: true },
    { valor: 'amarelo', label: 'Amarelo', proprio: true },
    { valor: 'vermelho', label: 'Vermelho', proprio: true },
    { valor: 'avarias', label: 'Avarias', proprio: true },
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
    // Passo "mover o endereço no ZenERP" (14/10/2026): se a bipagem deu certo mas o Zen
    // recusou mover o endereço, a resposta traz avisoZen e dá pra tentar só esse passo de novo.
    const [tentandoZen, setTentandoZen] = useState(false);
    const [zenResolvido, setZenResolvido] = useState(false);
    // Reprocessar o endereço no Zen de uma unidade que JÁ foi transferida (16/10/2026):
    // pra quando a transferência deu certo aqui, mas o Zen não mudou o estoque/reserva.
    const [serialReprocesso, setSerialReprocesso] = useState('');
    const [reprocessando, setReprocessando] = useState(false);
    const [msgReprocesso, setMsgReprocesso] = useState(null);
    // Transferência por pallet (19/10/2026), só pro Mercado Livre: bipa a etiqueta do pallet,
    // o coletor lista as unidades e transfere uma a uma pelo mesmo POST /bipar da bipagem normal.
    const [porPallet, setPorPallet] = useState(false);
    const [palletCodigo, setPalletCodigo] = useState('');
    const [palletInfo, setPalletInfo] = useState(null);
    const [palletBuscando, setPalletBuscando] = useState(false);
    const [palletErro, setPalletErro] = useState(null);
    const [palletConfirmar, setPalletConfirmar] = useState(false);
    const [palletRodando, setPalletRodando] = useState(false);
    const [palletProgresso, setPalletProgresso] = useState(null);
    const [palletResultado, setPalletResultado] = useState(null);
    const palletPararRef = useRef(false);
    const modoPallet = modo === 'saida' && destino === 'mercado_livre' && porPallet;

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
            const registro = { ...resposta, modo, destinoChave: destino };
            setZenResolvido(false);
            setUltimoResultado(registro);
            setHistorico((atual) => [registro, ...atual].slice(0, 20));
            setTotalSessao((atual) => atual + 1);
        } catch (e) {
            setErro(e.message);
        } finally {
            setProcessando(false);
        }
    }

    async function tentarMoverNoZen() {
        if (!ultimoResultado) return;
        setTentandoZen(true);
        setErro(null);
        try {
            await api.post('/transferencia-deposito/mover-endereco-zen', {
                serial: ultimoResultado.numeroSerie,
                destino: ultimoResultado.destinoChave,
            });
            setZenResolvido(true);
        } catch (e) {
            setErro(e.message);
        } finally {
            setTentandoZen(false);
        }
    }

    async function reprocessarNoZen() {
        const serial = serialReprocesso.trim();
        if (!serial) return;
        setReprocessando(true);
        setMsgReprocesso(null);
        try {
            const r = await api.post('/transferencia-deposito/mover-endereco-zen', { serial, destino });
            setMsgReprocesso({
                ok: true,
                texto: r?.status === 'ja_estava'
                    ? 'Já estava no endereço do depósito no ZenERP.'
                    : 'Endereço movido no ZenERP e alocação revertida.',
            });
            setSerialReprocesso('');
        } catch (e) {
            setMsgReprocesso({ ok: false, texto: e.message });
        } finally {
            setReprocessando(false);
        }
    }

    async function buscarPallet(codigoDigitado, manterResultado = false) {
        const codigo = String(codigoDigitado ?? palletCodigo).trim();
        if (!codigo) return;
        setPalletBuscando(true);
        setPalletErro(null);
        setPalletConfirmar(false);
        if (!manterResultado) setPalletResultado(null);
        try {
            const info = await api.get(`/transferencia-deposito/pallet/${encodeURIComponent(codigo)}`);
            setPalletInfo(info);
            setPalletCodigo('');
        } catch (e) {
            setPalletInfo(null);
            // depois de transferir, pallet esvaziado volta 404: não é erro, o resultado acima já diz tudo
            if (!manterResultado) setPalletErro(e.message);
        } finally {
            setPalletBuscando(false);
        }
    }

    async function transferirPallet() {
        if (!palletInfo || palletRodando || palletInfo.unidades.length === 0) return;
        const lista = [...palletInfo.unidades];
        const codigoPallet = palletInfo.etiquetaCodigo;
        palletPararRef.current = false;
        setPalletConfirmar(false);
        setPalletRodando(true);
        setPalletResultado(null);
        setErro(null);
        let feitas = 0;
        let falha = null;
        let parou = false;
        for (let i = 0; i < lista.length; i++) {
            if (palletPararRef.current) { parou = true; break; }
            const serial = lista[i];
            setPalletProgresso({ feitas, total: lista.length, atual: serial });
            try {
                const resposta = await api.post('/transferencia-deposito/bipar', { serial, destino: 'mercado_livre' });
                feitas += 1;
                const registro = { ...resposta, modo: 'saida', destinoChave: 'mercado_livre' };
                setHistorico((atual) => [registro, ...atual].slice(0, 20));
                setTotalSessao((atual) => atual + 1);
                if (resposta?.avisoZen) {
                    // Transferiu no WMS mas o Zen não moveu o endereço: para aqui, o resto espera.
                    falha = { serial, mensagem: resposta.avisoZen, zen: true };
                    break;
                }
            } catch (e) {
                falha = { serial, mensagem: e.message, zen: false };
                break;
            }
        }
        setPalletProgresso(null);
        setPalletResultado({ feitas, total: lista.length, falha, parou });
        setPalletRodando(false);
        // Recarrega o pallet: o que já saiu não aparece mais, sobram só as pendentes.
        await buscarPallet(codigoPallet, true);
    }

    // Em lote (19/10/2026): o servidor aloca por quantidade no Zen, dá baixa nas unidades de uma vez e
    // move/reverte. Pallet grande (30/10/2026, ex.: 1250): o servidor processa um BLOCO por chamada
    // (até 300) e responde `restantes`; aqui chamamos de novo até zerar. Cada bloco é atômico: se um
    // falhar ANTES de gravar, nada daquele bloco mudou e os anteriores ficam feitos.
    async function transferirPalletLote() {
        if (!palletInfo || palletRodando || palletInfo.unidades.length === 0) return;
        const codigoPallet = palletInfo.etiquetaCodigo;
        const total = palletInfo.unidades.length;
        setPalletConfirmar(false);
        setPalletRodando(true);
        setPalletResultado(null);
        setErro(null);
        setPalletProgresso({ feitas: 0, total, atual: null, lote: true });
        let feitas = 0;
        let falha = null;
        try {
            // trava de segurança contra laço infinito: nunca mais chamadas que o necessário (+ folga)
            for (let tentativa = 0; tentativa < 50; tentativa++) {
                const r = await api.post('/transferencia-deposito/pallet/transferir', { etiquetaCodigo: codigoPallet, destino: 'mercado_livre' });
                const registros = (r.unidades || []).map((numeroSerie) => ({
                    produto: r.produto, numeroSerie, destino: r.destino, modo: 'saida', destinoChave: 'mercado_livre',
                })).reverse();
                setHistorico((atual) => [...registros, ...atual].slice(0, 20));
                setTotalSessao((atual) => atual + (r.total || 0));
                feitas += r.total || 0;
                setPalletProgresso({ feitas, total, atual: null, lote: true });
                if (r.avisoZen) {
                    // Bloco gravado no sistema, mas o Zen não concluiu: para aqui (reprocessar o endereço antes de seguir).
                    falha = { serial: null, mensagem: r.avisoZen, zen: true };
                    break;
                }
                if (!(r.restantes > 0) || !(r.total > 0)) break;
            }
        } catch (e) {
            falha = { serial: null, mensagem: e.message, zen: false };
        } finally {
            setPalletProgresso(null);
            setPalletRodando(false);
        }
        setPalletResultado({ feitas, total, parou: false, lote: true, falha });
        // Recarrega: se deu erro de conexão no meio, mostra o que de fato ficou pendente.
        await buscarPallet(codigoPallet, true);
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
                    {destino === 'mercado_livre' && (
                        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                            <button
                                disabled={palletRodando}
                                className={!porPallet ? 'primary' : ''}
                                style={{ flex: 1 }}
                                onClick={() => setPorPallet(false)}
                            >
                                Por serial
                            </button>
                            <button
                                disabled={palletRodando}
                                className={porPallet ? 'primary' : ''}
                                style={{ flex: 1 }}
                                onClick={() => setPorPallet(true)}
                            >
                                Por pallet
                            </button>
                        </div>
                    )}
                    {DESTINOS.find((d) => d.valor === destino)?.proprio ? (
                        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '10px 0 0' }}>
                            Bipe o número de série de uma unidade que já saiu por transferência pra outro depósito.
                            O sistema acha a linha dela no ZenERP, move pro endereço do {DESTINOS.find((d) => d.valor === destino)?.label} e a unidade
                            volta pro picking, marcada com esse depósito.
                        </p>
                    ) : (
                        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '10px 0 0' }}>
                            Bipe o número de série de cada unidade que vai sair pro depósito escolhido acima.
                            Não tem lista prévia - bipa livremente, uma unidade por vez.
                        </p>
                    )}
                </div>
            ) : (
                <div className="card">
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                        Bipe o número de série de uma unidade que já tinha saído por essa tela e voltou fisicamente.
                        Ela volta pra posição de picking (flutuante) reservada pro SKU dela e, no ZenERP, a linha volta
                        pro endereço de origem e a alocação na reserva é revertida.
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
                    {ultimoResultado.modo !== 'retorno' && ultimoResultado.deDeposito && (
                        <p style={{ fontSize: 12, color: 'var(--success-text)' }}>De {ultimoResultado.deDeposito}</p>
                    )}
                    {ultimoResultado.modo !== 'retorno' && ultimoResultado.voltouPraPicking && (
                        <p style={{ fontSize: 12, color: 'var(--success-text)' }}>Voltou pro picking · posição {ultimoResultado.enderecoPickingCodigo}</p>
                    )}
                    {ultimoResultado.modo === 'retorno' && (
                        <p style={{ fontSize: 12, color: 'var(--success-text)' }}>Posição {ultimoResultado.enderecoPickingCodigo}</p>
                    )}
                    {ultimoResultado.modo === 'retorno' && (ultimoResultado.enderecoZen === 'movido' || ultimoResultado.enderecoZen === 'ja_estava') && !ultimoResultado.avisoZen && (
                        <p style={{ fontSize: 12, color: 'var(--success-text)' }}>Zen: linha de volta em {ultimoResultado.destinoZen || 'MAQ'} e alocação revertida</p>
                    )}
                    {ultimoResultado.modo !== 'retorno' && (ultimoResultado.enderecoZen === 'movido' || zenResolvido) && (
                        <p style={{ fontSize: 12, color: 'var(--success-text)' }}>Endereço movido no ZenERP</p>
                    )}
                </div>
            )}

            {ultimoResultado?.avisoZen && !zenResolvido && (
                <div className="card" style={{ background: 'var(--danger-bg)', border: '2px solid var(--danger-text)' }}>
                    <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--danger-text)' }}>⚠ Atenção: endereço no Zen</p>
                    <p style={{ fontSize: 14, color: 'var(--danger-text)' }}>{ultimoResultado.avisoZen}</p>
                    {ultimoResultado.modo !== 'retorno' && !ultimoResultado.voltouPraPicking && (
                        <button style={{ marginTop: 8 }} disabled={tentandoZen} onClick={tentarMoverNoZen}>
                            {tentandoZen ? 'Tentando...' : 'Tentar mover no Zen de novo'}
                        </button>
                    )}
                </div>
            )}

            {!modoPallet && <BipagemInput label="Bipar número de série" onBipar={biparSerial} />}

            {modoPallet && (
                <div className="card">
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 8px' }}>
                        Bipe a etiqueta do pallet. O sistema lista as unidades dele e, ao confirmar, transfere todas pro Mercado Livre,
                        uma por vez (igual à bipagem por serial). Se uma der erro, para ali e as já transferidas ficam feitas.
                    </p>
                    {!palletRodando && (
                        <div style={{ display: 'flex', gap: 8 }}>
                            <input
                                type="text"
                                autoFocus
                                value={palletCodigo}
                                onChange={(e) => setPalletCodigo(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') buscarPallet(); }}
                                placeholder="Etiqueta do pallet (ex.: PLTMU5K3N06Z)"
                                style={{ flex: 1 }}
                            />
                            <button disabled={palletBuscando || !palletCodigo.trim()} onClick={() => buscarPallet()}>
                                {palletBuscando ? 'Buscando...' : 'Buscar'}
                            </button>
                        </div>
                    )}
                    {palletErro && <p style={{ fontSize: 13, color: 'var(--danger-text)', margin: '8px 0 0' }}>{palletErro}</p>}

                    {palletInfo && (
                        <div style={{ marginTop: 10 }}>
                            <p style={{ fontSize: 14, margin: 0 }}><strong>{palletInfo.sku}</strong> · {palletInfo.descricao}</p>
                            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '2px 0' }}>
                                Pallet {palletInfo.etiquetaCodigo} · {palletInfo.enderecoCodigo || (palletInfo.areaAtual === 'pulmao' ? 'Pulmão' : 'sem posição')}
                                {palletInfo.deposito ? ` · ${palletInfo.deposito}` : ''}
                            </p>
                            <p style={{ fontSize: 14, margin: '6px 0' }}>
                                {palletInfo.unidades.length} unidade(s) serializada(s) pra transferir
                            </p>
                            {palletInfo.semSerial > 0 && (
                                <p style={{ fontSize: 12, color: 'var(--danger-text)', margin: '2px 0' }}>
                                    Atenção: o pallet conta {palletInfo.quantidade}, mas só {palletInfo.unidades.length} têm serial no sistema.
                                    As outras {palletInfo.semSerial} não entram nessa transferência.
                                </p>
                            )}
                            {palletInfo.unidades.length > 0 && !palletRodando && !palletConfirmar && (
                                <button className="primary" style={{ width: '100%', marginTop: 6 }} onClick={() => setPalletConfirmar(true)}>
                                    Transferir {palletInfo.unidades.length} unidade(s) pro Mercado Livre
                                </button>
                            )}
                            {palletConfirmar && !palletRodando && (
                                <div style={{ marginTop: 6 }}>
                                    <p style={{ fontSize: 13, margin: '0 0 6px' }}>
                                        Confirma transferir {palletInfo.unidades.length} unidade(s) do SKU {palletInfo.sku} pro Mercado Livre?
                                    </p>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        <button className="primary" onClick={transferirPalletLote}>Confirmar (em lote, rápido)</button>
                                        <button onClick={transferirPallet}>Uma a uma (mais lento)</button>
                                        <button onClick={() => setPalletConfirmar(false)}>Cancelar</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {palletRodando && palletProgresso && (
                        <div style={{ marginTop: 10 }}>
                            {palletProgresso.lote ? (
                                <p style={{ fontSize: 14, margin: 0 }}>
                                    Transferindo o pallet em lote ({palletProgresso.feitas} de {palletProgresso.total} unidades)... não feche a tela.
                                </p>
                            ) : (
                                <>
                                    <p style={{ fontSize: 14, margin: 0 }}>
                                        Transferindo {palletProgresso.feitas + 1} de {palletProgresso.total}...
                                    </p>
                                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '2px 0 6px' }}>{palletProgresso.atual}</p>
                                    <button onClick={() => { palletPararRef.current = true; }}>Parar após esta unidade</button>
                                </>
                            )}
                        </div>
                    )}

                    {palletResultado && (
                        <div style={{ marginTop: 10 }}>
                            <p style={{ fontSize: 14, margin: 0, color: palletResultado.falha ? 'var(--danger-text)' : 'inherit' }}>
                                {palletResultado.lote && palletResultado.falha && !palletResultado.falha.zen
                                    ? (palletResultado.feitas > 0
                                        ? `Transferiu ${palletResultado.feitas} de ${palletResultado.total} unidade(s) e parou.`
                                        : 'Não transferiu o pallet.')
                                    : palletResultado.falha
                                    ? (palletResultado.lote
                                        ? `Pallet transferido no sistema (${palletResultado.feitas} unidade(s)), mas o ZenERP não concluiu.`
                                        : `Parou: ${palletResultado.feitas} de ${palletResultado.total} transferida(s).`)
                                    : palletResultado.parou
                                        ? `Interrompido: ${palletResultado.feitas} de ${palletResultado.total} transferida(s).`
                                        : `Pallet transferido: ${palletResultado.feitas} unidade(s) pro Mercado Livre.`}
                            </p>
                            {palletResultado.falha && (
                                <p style={{ fontSize: 13, color: 'var(--danger-text)', margin: '4px 0 0' }}>
                                    {palletResultado.lote
                                        ? (palletResultado.falha.zen
                                            ? palletResultado.falha.mensagem
                                            : `${palletResultado.falha.mensagem} (se foi erro de conexão, confira abaixo o que ficou pendente no pallet).`)
                                        : palletResultado.falha.zen
                                        ? `A unidade ${palletResultado.falha.serial} foi transferida no sistema, mas o ZenERP não concluiu: ${palletResultado.falha.mensagem} Use "Reprocessar endereço no Zen" abaixo com esse serial; depois bipe o pallet de novo pra continuar com as que faltam.`
                                        : `Erro na unidade ${palletResultado.falha.serial}: ${palletResultado.falha.mensagem} As anteriores ficaram feitas. Resolva e bipe o pallet de novo pra continuar com as que faltam.`}
                                </p>
                            )}
                        </div>
                    )}
                </div>
            )}
            {processando && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{modo === 'retorno' ? 'Devolvendo...' : 'Transferindo...'}</p>}
            {erro && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erro}</p>}

            {modo === 'saida' && !DESTINOS.find((d) => d.valor === destino)?.proprio && (
                <details className="card">
                    <summary style={{ fontSize: 13, cursor: 'pointer' }}>Reprocessar endereço no Zen (serial já transferido)</summary>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '8px 0' }}>
                        Use quando a unidade já aparece como transferida aqui, mas o estoque/reserva no ZenERP não mudou.
                        Informe o serial; o sistema move a linha pro endereço de {DESTINOS.find((d) => d.valor === destino)?.label} e reverte a alocação.
                    </p>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <input
                            type="text"
                            value={serialReprocesso}
                            onChange={(e) => setSerialReprocesso(e.target.value)}
                            placeholder="Número de série (ex.: #101613)"
                            style={{ flex: 1 }}
                        />
                        <button disabled={reprocessando || !serialReprocesso.trim()} onClick={reprocessarNoZen}>
                            {reprocessando ? 'Processando...' : 'Reprocessar'}
                        </button>
                    </div>
                    {msgReprocesso && (
                        <p style={{ fontSize: 13, margin: '8px 0 0', color: msgReprocesso.ok ? 'var(--success-text, inherit)' : 'var(--danger-text)' }}>
                            {msgReprocesso.texto}
                        </p>
                    )}
                </details>
            )}

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
