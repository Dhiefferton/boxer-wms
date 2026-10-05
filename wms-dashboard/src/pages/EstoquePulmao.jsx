import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useDefinirTitulo } from '../contexts/TituloPaginaContext.jsx';

// Estoque Pulmão (11/09/2026): área aberta no chão, sem endereço
// próprio - usada como vertedouro quando o recebimento não acha
// posição livre no vertical (andares 2-5). Essa tela é só leitura:
// quem move de verdade é o coletor, de forma MANUAL (desde 05/10/2026,
// a pedido do Dhiefferton - acabou a fila automática): tela "Estoque
// Pulmão → Vertical", o operador bipa a etiqueta de qualquer pallet do
// Pulmão ou do Pulmão Teste, o sistema escolhe a posição sozinho e o
// pallet sobe com a mesma etiqueta (ver wms-api/lib/pulmao.js).
const INTERVALO_ATUALIZACAO_MS = 15000;

function tempoRelativo(dataIso) {
    const diffMs = Date.now() - new Date(dataIso).getTime();
    const min = Math.round(diffMs / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return `há ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `há ${h}h`;
    return `há ${Math.round(h / 24)}d`;
}

export default function EstoquePulmao() {
    useDefinirTitulo('Estoque Pulmão');
    const [aba, setAba] = useState('pulmao'); // 'pulmao' | 'teste'
    const [noPulmao, setNoPulmao] = useState([]);
    const [carregando, setCarregando] = useState(true);
    const [erro, setErro] = useState(null);

    // Pulmão Teste (30/09/2026, a pedido do Dhiefferton): máquinas que
    // precisam ser testadas antes de subir pro vertical - mesma área
    // física do Estoque Pulmão de sempre, só que com teste_status
    // 'nao_testado' (ver criarPalletRecebimento, wms-api/routes/
    // recebimento.js). Não entram sozinhas na fila de reabastecimento
    // enquanto ninguém aprovar o teste aqui (ou subir direto pelo coletor).
    const [noPulmaoTeste, setNoPulmaoTeste] = useState([]);
    const [carregandoTeste, setCarregandoTeste] = useState(true);
    const [erroTeste, setErroTeste] = useState(null);
    const [aprovando, setAprovando] = useState(null); // id do pallet sendo aprovado agora

    // Mandar SKU pro Pulmão Teste manualmente (30/09/2026) - mecanismo
    // pra fazer por aqui o que antes só dava pra pedir direto no chat:
    // tira todo o estoque de um SKU do vertical (liberando a(s)
    // posição(ões)) e/ou do Estoque Pulmão normal, e joga pro Pulmão
    // Teste de uma vez (ver POST /pulmao/teste/por-sku).
    const [skuParaTeste, setSkuParaTeste] = useState('');
    const [enviandoSku, setEnviandoSku] = useState(false);
    const [resultadoSku, setResultadoSku] = useState(null);

    const carregar = useCallback(() => {
        api
            .get('/pulmao')
            .then(setNoPulmao)
            .catch((e) => setErro(e.message))
            .finally(() => setCarregando(false));
    }, []);

    const carregarTeste = useCallback(() => {
        api
            .get('/pulmao/teste')
            .then(setNoPulmaoTeste)
            .catch((e) => setErroTeste(e.message))
            .finally(() => setCarregandoTeste(false));
    }, []);

    useEffect(() => {
        carregar();
        carregarTeste();
        const intervalo = setInterval(() => {
            carregar();
            carregarTeste();
        }, INTERVALO_ATUALIZACAO_MS);
        return () => clearInterval(intervalo);
    }, [carregar, carregarTeste]);

    async function aprovarTeste(palletId) {
        setAprovando(palletId);
        try {
            await api.post(`/pulmao/teste/${palletId}/aprovar`);
            carregarTeste();
            carregar();
        } catch (e) {
            setErroTeste(e.message);
        } finally {
            setAprovando(null);
        }
    }

    async function enviarSkuParaTeste(evento) {
        evento.preventDefault();
        const sku = skuParaTeste.trim();
        if (!sku) return;
        setEnviandoSku(true);
        setResultadoSku(null);
        try {
            const resposta = await api.post('/pulmao/teste/por-sku', { sku });
            const posicoes =
                resposta.posicoesLiberadas?.length > 0
                    ? ` Posição(ões) liberada(s) no vertical: ${resposta.posicoesLiberadas.join(', ')}.`
                    : '';
            setResultadoSku({
                ok: true,
                texto: `${resposta.palletsMovidos} pallet(s) do SKU ${resposta.sku} (${resposta.descricao}) enviado(s) pro Pulmão Teste.${posicoes}`,
            });
            setSkuParaTeste('');
            carregarTeste();
            carregar();
        } catch (e) {
            setResultadoSku({ ok: false, texto: e.message });
        } finally {
            setEnviandoSku(false);
        }
    }

    return (
        <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: '1.25rem', borderBottom: '1px solid var(--border)' }}>
                {[
                    { chave: 'pulmao', label: 'Estoque Pulmão' },
                    { chave: 'teste', label: `Pulmão Teste${noPulmaoTeste.length > 0 ? ` (${noPulmaoTeste.length})` : ''}` },
                ].map((item) => (
                    <button
                        key={item.chave}
                        onClick={() => setAba(item.chave)}
                        style={{
                            border: 'none',
                            background: 'transparent',
                            padding: '8px 4px',
                            marginBottom: -1,
                            fontSize: 13,
                            fontWeight: aba === item.chave ? 700 : 500,
                            color: aba === item.chave ? 'var(--text-primary)' : 'var(--text-secondary)',
                            borderBottom: aba === item.chave ? '2px solid var(--boxer-vibrante)' : '2px solid transparent',
                            cursor: 'pointer',
                        }}
                    >
                        {item.label}
                    </button>
                ))}
            </div>

            {aba === 'teste' ? (
                <div>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 640, margin: '0 0 1rem' }}>
                        Máquinas recebidas direto pro Pulmão Teste (opção escolhida no recebimento) - ficam esperando aqui, sem
                        endereço no vertical. Quem sobe pro vertical é o coletor (tela "Estoque Pulmão → Vertical"): bipa a
                        etiqueta e o sistema escolhe a posição - dá pra subir direto daqui, sem esperar aprovação. "Aprovar
                        teste" só marca o pallet como testado.
                    </p>

                    <form
                        onSubmit={enviarSkuParaTeste}
                        className="card"
                        style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', maxWidth: 560, marginBottom: 12 }}
                    >
                        <div style={{ flex: 1, minWidth: 160 }}>
                            <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                                Mandar um SKU direto pro Pulmão Teste
                            </label>
                            <input
                                type="text"
                                value={skuParaTeste}
                                onChange={(e) => setSkuParaTeste(e.target.value)}
                                placeholder="SKU"
                                style={{ width: '100%' }}
                            />
                            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0' }}>
                                Tira todo o estoque desse SKU do vertical (liberando a(s) posição(ões) que ele ocupava) e/ou do
                                Estoque Pulmão normal, e manda pra cá - pra quando um modelo já recebido precisar ser retirado
                                pra teste depois.
                            </p>
                        </div>
                        <button type="submit" disabled={enviandoSku || !skuParaTeste.trim()} style={{ flexShrink: 0 }}>
                            {enviandoSku ? 'Enviando...' : 'Enviar'}
                        </button>
                    </form>
                    {resultadoSku && (
                        <p
                            style={{
                                fontSize: 12,
                                color: resultadoSku.ok ? 'var(--text-secondary)' : 'var(--danger-text)',
                                maxWidth: 560,
                                marginTop: -4,
                                marginBottom: 16,
                            }}
                        >
                            {resultadoSku.texto}
                        </p>
                    )}

                    {carregandoTeste && <p>Carregando...</p>}
                    {erroTeste && <p style={{ color: 'var(--danger-text)' }}>{erroTeste}</p>}
                    {!carregandoTeste && !erroTeste && (
                        noPulmaoTeste.length === 0 ? (
                            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nada esperando teste agora.</p>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 520 }}>
                                {noPulmaoTeste.map((item) => (
                                    <div
                                        key={item.id}
                                        className="card"
                                        style={{ borderLeft: '3px solid var(--warning-text)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
                                    >
                                        <div>
                                            <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{item.sku}</p>
                                            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '2px 0 6px' }}>{item.descricao}</p>
                                            <p style={{ fontSize: 12, margin: 0 }}>
                                                {item.quantidade} un. · etiqueta {item.etiqueta_codigo}
                                            </p>
                                            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0' }}>
                                                No Pulmão Teste desde {tempoRelativo(item.data_entrada)}
                                            </p>
                                        </div>
                                        <button disabled={aprovando === item.id} onClick={() => aprovarTeste(item.id)} style={{ flexShrink: 0 }}>
                                            {aprovando === item.id ? 'Aprovando...' : 'Aprovar teste'}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )
                    )}
                </div>
            ) : (
            <div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 640, margin: '0 0 1.5rem' }}>
                Área aberta no chão, usada quando o recebimento não acha posição livre no vertical. Pra subir um pallet, o
                operador usa o coletor ("Estoque Pulmão → Vertical"): bipa a etiqueta (ou escolhe na lista), o sistema escolhe
                a posição no vertical sozinho e o pallet sobe com a mesma etiqueta - a tela do coletor mostra onde guardar.
            </p>

            {carregando && <p>Carregando...</p>}
            {erro && <p style={{ color: 'var(--danger-text)' }}>{erro}</p>}

            {!carregando && !erro && (
                <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 300 }}>
                        <h3 style={{ fontSize: 15, marginBottom: 10 }}>
                            No chão agora <span className="badge warning">{noPulmao.length}</span>
                        </h3>
                        {noPulmao.length === 0 ? (
                            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nada no Pulmão agora - vertical com espaço.</p>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {noPulmao.map((item) => (
                                    <div key={item.sku} className="card" style={{ borderLeft: '3px solid var(--warning-text)' }}>
                                        <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{item.sku}</p>
                                        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '2px 0 8px' }}>{item.descricao}</p>
                                        <p style={{ fontSize: 12, margin: 0 }}>
                                            {item.quantidade_total} un. · {item.total_pallets} pallet(s)
                                        </p>
                                        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0' }}>
                                            No Pulmão desde {tempoRelativo(item.mais_antigo_desde)}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                </div>
            )}
            </div>
            )}
        </div>
    );
}
