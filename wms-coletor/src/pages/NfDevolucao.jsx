import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import EtiquetasTermicas10x5 from '../components/EtiquetaTermica10x5.jsx';

// Devolução - mesma lógica do Recebimento por NF (NfImportacao.jsx):
// escolhe a nota -> escolhe o item -> confirma. Diferença: aqui o
// conferente faz a TRIAGEM na mesma tela - quanto do que voltou está
// bom pra revenda e quanto está defeituoso/avariado (não gera pallet
// nenhum - só fica registrado no histórico; o destino físico dele -
// assistência técnica, descarte etc. - ainda é tratado por fora do
// WMS).
//
// AJUSTE 26/09/2026: a parte "boa" também não gera mais pallet - vai
// direto pro picking (posição já reservada pro SKU no Mapa de ruas),
// sem precisar escolher depósito (isso só existia por causa do
// pallet). Produto serializado sempre ganha número de série NOVO
// (não reaproveita o serial de quando a máquina saiu).
//
// AJUSTE 26/09/2026 (2): produto serializado não vai mais direto pro
// picking - passa primeiro pelo Estoque Devolução (uma das 4 posições
// fixas do Mapa de ruas), onde alguém ainda vai definir o depósito
// final e bipar cada etiqueta (tela "Estoque Devolução" do coletor) -
// só aí a unidade chega no picking de verdade. Produto NÃO serializado
// continua indo direto pro picking, sem passar por essa etapa
// (resposta continua vindo em pickingConfirmado).
export default function NfDevolucao() {
    const navigate = useNavigate();
    const [notas, setNotas] = useState(null);
    const [carregandoNotas, setCarregandoNotas] = useState(true);
    const [filtro, setFiltro] = useState('');
    const [notaSelecionada, setNotaSelecionada] = useState(null);
    const [itens, setItens] = useState(null);
    const [carregandoItens, setCarregandoItens] = useState(false);
    const [itemSelecionado, setItemSelecionado] = useState(null);
    const [quantidadeBoaInput, setQuantidadeBoaInput] = useState('');
    const [quantidadeDefeituosaInput, setQuantidadeDefeituosaInput] = useState('0');
    const [confirmando, setConfirmando] = useState(false);
    const [resultado, setResultado] = useState(null);
    const [erro, setErro] = useState(null);
    // ADICIONADO 01/10/2026 (a pedido do Dhiefferton - "Quero a opção de
    // fazer as etiquetas todas de uma vez só, pode ser uma caixa de
    // seleção"): seleção em lote na Tela 2. Cada item pendente ganha uma
    // checkbox; "Confirmar N selecionado(s)" dispara uma confirmação
    // SEQUENCIAL (uma PATCH por vez, nunca em paralelo - evita corrida no
    // calculo de notaConcluida/pendencias no backend) assumindo que toda a
    // quantidade que falta em cada item é "boa pra revenda" (sem campo de
    // defeituoso no modo lote - item com defeito de verdade continua sendo
    // confirmado individualmente pela Tela 3, como já era).
    const [itensSelecionados, setItensSelecionados] = useState([]);
    const [confirmandoLote, setConfirmandoLote] = useState(false);
    const [progressoLote, setProgressoLote] = useState(null);
    const [resultadoLote, setResultadoLote] = useState(null);
    // CORRIGIDO (27/09/2026, a pedido do Dhiefferton - "deixe com a opção
    // de mostrar e não mostrar os arquivados", pedido na tela de
    // Recebimento por NF e replicado aqui pra manter as duas listas
    // consistentes): a seção de arquivadas começa escondida (só o título
    // com a contagem aparece) - um clique no título mostra a lista,
    // outro clique esconde de novo.
    const [mostrarArquivadas, setMostrarArquivadas] = useState(false);

    useEffect(() => {
        carregarNotas();
    }, []);

    function carregarNotas() {
        setCarregandoNotas(true);
        api
            .get('/nf-devolucao')
            .then(setNotas)
            .catch((e) => setErro(e.message))
            .finally(() => setCarregandoNotas(false));
    }

    function carregarItensDaNota(notaAlvo) {
        setErro(null);
        setCarregandoItens(true);
        return api
            .get(`/nf-devolucao/${notaAlvo.id}/itens`)
            .then((resposta) => setItens(resposta.itens))
            .catch((e) => setErro(e.message))
            .finally(() => setCarregandoItens(false));
    }

    function abrirNota(nota) {
        setNotaSelecionada(nota);
        setItens(null);
        setItensSelecionados([]);
        setResultadoLote(null);
        carregarItensDaNota(nota);
    }

    // ADICIONADO 01/10/2026: recarrega só a lista de itens da nota já
    // aberta, sem mexer em notaSelecionada nem voltar pra Tela 1 - usado
    // depois de uma confirmação em lote pra atualizar os status (completo/
    // pendente) sem resetar estado que não tem nada a ver com isso.
    function recarregarItens() {
        setItensSelecionados([]);
        setResultadoLote(null);
        carregarItensDaNota(notaSelecionada);
    }

    function voltarParaNotas() {
        setNotaSelecionada(null);
        setItens(null);
        setItemSelecionado(null);
        setItensSelecionados([]);
        setResultadoLote(null);
        setErro(null);
        carregarNotas();
    }

    function abrirItem(item) {
        setItemSelecionado(item);
        const falta = item.quantidadeEsperada - item.quantidadeRecebida;
        setQuantidadeBoaInput(String(falta));
        setQuantidadeDefeituosaInput('0');
        setResultado(null);
        setErro(null);
    }

    function voltarParaItens() {
        setItemSelecionado(null);
        setResultado(null);
        setErro(null);
    }

    const quantidadeBoa = Number(quantidadeBoaInput) || 0;
    const quantidadeDefeituosa = Number(quantidadeDefeituosaInput) || 0;
    const quantidadeTotal = quantidadeBoa + quantidadeDefeituosa;
    const falta = itemSelecionado ? itemSelecionado.quantidadeEsperada - itemSelecionado.quantidadeRecebida : 0;
    const passouDoEsperado = quantidadeTotal > falta;
    const podeConfirmar = quantidadeTotal > 0 && !passouDoEsperado && !confirmando;

    async function confirmarDevolucao() {
        setConfirmando(true);
        setErro(null);
        try {
            const resposta = await api.patch(`/nf-devolucao/itens/${itemSelecionado.id}/receber`, {
                quantidadeBoa,
                quantidadeDefeituosa,
            });
            setResultado(resposta);
        } catch (e) {
            setErro(e.message);
        } finally {
            setConfirmando(false);
        }
    }

    function alternarSelecaoItem(itemId) {
        setItensSelecionados((atual) =>
            atual.includes(itemId) ? atual.filter((id) => id !== itemId) : [...atual, itemId]
        );
    }

    // Confirma em lote: um PATCH por item, em sequência (nunca em
    // paralelo) e assumindo quantidadeBoa = tudo que falta, quantidadeDefeituosa
    // = 0 pra cada um (ver comentário no estado itensSelecionados). Para no
    // primeiro erro - os itens antes dele na lista já foram confirmados de
    // verdade no backend e isso fica registrado em resultadoLote.sucesso; os
    // que viriam depois NÃO são tentados, pra não mascarar qual item falhou.
    async function confirmarLote() {
        if (!itens || itensSelecionados.length === 0) return;
        const itensParaConfirmar = itens.filter((item) => itensSelecionados.includes(item.id));

        setConfirmandoLote(true);
        setResultadoLote(null);

        const sucesso = [];
        let falha = null;
        let notaConcluida = false;

        for (let i = 0; i < itensParaConfirmar.length; i++) {
            const item = itensParaConfirmar[i];
            setProgressoLote({ atual: i + 1, total: itensParaConfirmar.length });
            const faltaItem = item.quantidadeEsperada - item.quantidadeRecebida;
            try {
                const resposta = await api.patch(`/nf-devolucao/itens/${item.id}/receber`, {
                    quantidadeBoa: faltaItem,
                    quantidadeDefeituosa: 0,
                });
                sucesso.push({ item, resposta });
                if (resposta.notaConcluida) {
                    notaConcluida = true;
                }
            } catch (e) {
                falha = { item, erro: e.message };
                break;
            }
        }

        setProgressoLote(null);
        setConfirmandoLote(false);
        setItensSelecionados([]);
        setResultadoLote({ sucesso, falha, notaConcluida });
    }

    // ------------------------------------------------------------
    // Tela 1: lista de notas de devolução
    // ------------------------------------------------------------
    if (!notaSelecionada) {
        const termo = filtro.trim().toLowerCase();
        const notasFiltradas = notas
            ? notas.filter(
                  (nota) =>
                      String(nota.numero ?? '').toLowerCase().includes(termo) ||
                      String(nota.cliente ?? '').toLowerCase().includes(termo)
              )
            : [];
        // NFs só de peça do almoxarifado nem chegam aqui (o backend já
        // exclui - ver comentário em nf-devolucao.js). O que sobra
        // concluído (arquivada=true) vai numa seção separada no fim da
        // lista, pra não competir com as pendentes/em andamento.
        const notasAtivas = notasFiltradas.filter((nota) => !nota.arquivada);
        const notasArquivadas = notasFiltradas.filter((nota) => nota.arquivada);

        return (
            <div className="tela">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <button onClick={() => navigate('/')}>←</button>
                    <span className="badge accent">Devolução por NF</span>
                </div>

                <input
                    type="text"
                    placeholder="Buscar por número da NF ou cliente"
                    value={filtro}
                    onChange={(e) => setFiltro(e.target.value)}
                />

                {carregandoNotas && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Consultando ZenERP...</p>}
                {erro && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erro}</p>}

                {notas && notas.length === 0 && (
                    <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nenhuma NF de devolução encontrada.</p>
                )}

                {notas && notas.length > 0 && notasFiltradas.length === 0 && (
                    <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nenhuma NF encontrada com essa busca.</p>
                )}

                {notasAtivas.map((nota) => (
                    <button
                        key={nota.id}
                        onClick={() => abrirNota(nota)}
                        style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                            <span style={{ fontWeight: 600 }}>NF {nota.numero}</span>
                            <span
                                className={`badge ${nota.statusDevolucao === 'concluida' ? 'success' : 'warning'}`}
                                style={{ fontSize: 11 }}
                            >
                                {nota.statusDevolucao}
                            </span>
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{nota.cliente}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{nota.data}</span>
                    </button>
                ))}

                {notasArquivadas.length > 0 && (
                    <>
                        <button
                            onClick={() => setMostrarArquivadas((atual) => !atual)}
                            style={{
                                fontSize: 11,
                                color: 'var(--text-muted)',
                                textTransform: 'uppercase',
                                letterSpacing: 0.5,
                                marginTop: 12,
                                borderTop: '1px solid var(--border)',
                                paddingTop: 8,
                                background: 'none',
                                display: 'flex',
                                justifyContent: 'space-between',
                                width: '100%',
                            }}
                        >
                            <span>Arquivadas (concluídas) · {notasArquivadas.length}</span>
                            <span>{mostrarArquivadas ? 'Ocultar ▲' : 'Mostrar ▼'}</span>
                        </button>
                        {mostrarArquivadas && notasArquivadas.map((nota) => (
                            <button
                                key={nota.id}
                                onClick={() => abrirNota(nota)}
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'flex-start',
                                    gap: 2,
                                    opacity: 0.6,
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                                    <span style={{ fontWeight: 600 }}>NF {nota.numero}</span>
                                    <span className="badge success" style={{ fontSize: 11 }}>
                                        {nota.statusDevolucao}
                                    </span>
                                </div>
                                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{nota.cliente}</span>
                                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{nota.data}</span>
                            </button>
                        ))}
                    </>
                )}
            </div>
        );
    }

    // ------------------------------------------------------------
    // Tela 2: itens da NF selecionada
    // ------------------------------------------------------------
    if (!itemSelecionado) {
        // ------------------------------------------------------------
        // Tela 2b: resultado da confirmação em lote
        // ------------------------------------------------------------
        if (resultadoLote) {
            const etiquetasLote = [];
            resultadoLote.sucesso.forEach(({ item, resposta }) => {
                const series =
                    resposta.pickingConfirmado?.numerosSerieGerados ||
                    resposta.estoqueDevolucaoConfirmado?.numerosSerieGerados ||
                    [];
                series.forEach((serie) => {
                    etiquetasLote.push({
                        tipo: 'default',
                        sku: item.sku,
                        descricao: item.descricao,
                        codigoBarras: resposta.produtoCodigoBarras,
                        numeroSerie: serie,
                    });
                });
            });
            if (resultadoLote.notaConcluida) {
                etiquetasLote.push({
                    tipo: 'nf',
                    numeroNF: notaSelecionada.numero,
                    cliente: notaSelecionada.cliente,
                    data: notaSelecionada.data,
                });
            }

            return (
                <div className="tela">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <button onClick={recarregarItens}>←</button>
                        <span className="badge accent">NF {notaSelecionada.numero}</span>
                    </div>

                    <div className="card" style={{ background: 'var(--success-bg)' }}>
                        <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--success-text)' }}>
                            {resultadoLote.sucesso.length} de {resultadoLote.sucesso.length + (resultadoLote.falha ? 1 : 0)}{' '}
                            item(ns) confirmado(s) com sucesso
                        </p>
                    </div>

                    {resultadoLote.sucesso.map(({ item }) => (
                        <div key={item.id} className="card">
                            <p style={{ fontSize: 14, fontWeight: 600 }}>{item.sku}</p>
                            <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.descricao}</p>
                            <p style={{ fontSize: 12, color: 'var(--success-text)' }}>
                                {item.quantidadeEsperada - item.quantidadeRecebida} unidade(s) · bom pra revenda
                            </p>
                        </div>
                    ))}

                    {resultadoLote.falha && (
                        <div className="card" style={{ background: 'var(--danger-bg)' }}>
                            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--danger-text)' }}>
                                Falha ao confirmar {resultadoLote.falha.item.sku}
                            </p>
                            <p style={{ fontSize: 12, color: 'var(--danger-text)' }}>{resultadoLote.falha.erro}</p>
                            <p style={{ fontSize: 12, color: 'var(--danger-text)' }}>
                                A confirmação em lote parou aqui - os itens acima já foram confirmados de verdade, os
                                demais que estavam selecionados depois deste não foram tentados. Confirme esse e os
                                restantes individualmente.
                            </p>
                        </div>
                    )}

                    {resultadoLote.notaConcluida && (
                        <p style={{ fontSize: 12, color: 'var(--success-text)', marginTop: 4 }}>
                            NF concluída - todos os itens foram confirmados.
                        </p>
                    )}

                    {etiquetasLote.length > 0 && <EtiquetasTermicas10x5 etiquetas={etiquetasLote} />}

                    <button className="primary" style={{ width: '100%', marginTop: 8 }} onClick={recarregarItens}>
                        Voltar pros itens
                    </button>
                </div>
            );
        }

        // ------------------------------------------------------------
        // Tela 2: itens da NF selecionada
        // ------------------------------------------------------------
        const itensPendentes = itens ? itens.filter((item) => item.quantidadeRecebida < item.quantidadeEsperada) : [];
        const todosPendentesSelecionados =
            itensPendentes.length > 0 && itensSelecionados.length === itensPendentes.length;

        return (
            <div className="tela">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <button onClick={voltarParaNotas}>←</button>
                    <span className="badge accent">NF {notaSelecionada.numero}</span>
                </div>

                <div className="card">
                    <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Cliente</p>
                    <p style={{ fontSize: 14, fontWeight: 600 }}>{notaSelecionada.cliente}</p>
                </div>

                {carregandoItens && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Carregando itens...</p>}
                {erro && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erro}</p>}

                {itensPendentes.length > 1 && (
                    <button
                        onClick={() =>
                            setItensSelecionados(todosPendentesSelecionados ? [] : itensPendentes.map((item) => item.id))
                        }
                        style={{
                            fontSize: 12,
                            color: 'var(--text-muted)',
                            background: 'none',
                            alignSelf: 'flex-end',
                            padding: 0,
                        }}
                    >
                        {todosPendentesSelecionados ? 'Limpar seleção' : 'Selecionar todos pendentes'}
                    </button>
                )}

                {itens &&
                    itens.map((item) => {
                        const completo = item.quantidadeRecebida >= item.quantidadeEsperada;
                        const selecionado = itensSelecionados.includes(item.id);
                        return (
                            <div key={item.id} style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
                                {!completo && (
                                    <input
                                        type="checkbox"
                                        checked={selecionado}
                                        onChange={() => alternarSelecaoItem(item.id)}
                                        style={{ flexShrink: 0, width: 20, marginTop: 10 }}
                                    />
                                )}
                                <button
                                    disabled={completo}
                                    onClick={() => abrirItem(item)}
                                    style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'flex-start',
                                        gap: 2,
                                        opacity: completo ? 0.5 : 1,
                                        flex: 1,
                                        marginLeft: completo ? 28 : 0,
                                    }}
                                >
                                    <span style={{ fontWeight: 600 }}>{item.sku}</span>
                                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.descricao}</span>
                                    <span style={{ fontSize: 12, color: completo ? 'var(--success-text)' : 'var(--text-muted)' }}>
                                        {item.quantidadeRecebida} de {item.quantidadeEsperada} confirmado(s)
                                        {item.quantidadeBoa > 0 && ` · ${item.quantidadeBoa} boa(s)`}
                                        {item.quantidadeDefeituosa > 0 && ` · ${item.quantidadeDefeituosa} defeituosa(s)`}
                                        {completo ? ' · completo' : ''}
                                        {item.recebidoAutomaticamente ? ' · automático (sem cadastro/almoxarifado)' : ''}
                                    </span>
                                </button>
                            </div>
                        );
                    })}

                {itensSelecionados.length > 0 && (
                    <div
                        className="card"
                        style={{
                            position: 'sticky',
                            bottom: 0,
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 8,
                        }}
                    >
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{itensSelecionados.length} selecionado(s)</span>
                        <button className="primary" disabled={confirmandoLote} onClick={confirmarLote}>
                            {confirmandoLote
                                ? `Confirmando ${progressoLote?.atual ?? ''} de ${progressoLote?.total ?? itensSelecionados.length}...`
                                : `Confirmar ${itensSelecionados.length} selecionado(s)`}
                        </button>
                    </div>
                )}
            </div>
        );
    }

    // ------------------------------------------------------------
    // Tela 3: confirmar a triagem do item selecionado
    // ------------------------------------------------------------
    return (
        <div className="tela">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button onClick={voltarParaItens}>←</button>
                <span className="badge accent">{itemSelecionado.sku}</span>
            </div>

            {resultado ? (
                <>
                    {resultado.pickingConfirmado && (
                        <div className="card" style={{ background: 'var(--success-bg)' }}>
                            <p style={{ fontSize: 11, color: 'var(--success-text)' }}>
                                Bom pra revenda - enviado direto pro picking
                            </p>
                            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--success-text)' }}>
                                {resultado.pickingConfirmado.enderecoPickingCodigo} · {resultado.pickingConfirmado.quantidade} unidade(s)
                                {resultado.pickingConfirmado.numerosSerieGerados?.length > 0 &&
                                    ` · ${resultado.pickingConfirmado.numerosSerieGerados.length} série(s)`}
                            </p>
                        </div>
                    )}

                    {resultado.estoqueDevolucaoConfirmado && (
                        <div className="card" style={{ background: 'var(--success-bg)' }}>
                            <p style={{ fontSize: 11, color: 'var(--success-text)' }}>
                                Bom pra revenda - enviado pro Estoque Devolução (aguardando definir depósito e bipar)
                            </p>
                            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--success-text)' }}>
                                {resultado.estoqueDevolucaoConfirmado.enderecoCodigo} · {resultado.estoqueDevolucaoConfirmado.quantidade} unidade(s)
                                {resultado.estoqueDevolucaoConfirmado.numerosSerieGerados?.length > 0 &&
                                    ` · ${resultado.estoqueDevolucaoConfirmado.numerosSerieGerados.length} série(s)`}
                            </p>
                            <p style={{ fontSize: 12, color: 'var(--success-text)' }}>
                                Vai pra tela "Estoque Devolução" pra definir o depósito (Máquinas/Verde/Amarelo/Vermelho/Avarias) e bipar cada etiqueta antes de virar picking de verdade.
                            </p>
                        </div>
                    )}

                    {resultado.quantidadeDefeituosaConfirmada > 0 && (
                        <div className="card" style={{ background: 'var(--danger-bg)' }}>
                            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--danger-text)' }}>
                                {quantidadeDefeituosa} unidade(s) registrada(s) como defeituosa/avariada
                            </p>
                            <p style={{ fontSize: 12, color: 'var(--danger-text)' }}>
                                Não gerou pallet nem endereço - encaminhe fisicamente conforme o processo interno (assistência técnica, descarte etc.).
                            </p>
                        </div>
                    )}

                    {resultado.notaConcluida && (
                        <p style={{ fontSize: 12, color: 'var(--success-text)', marginTop: 4 }}>
                            NF concluída - todos os itens foram confirmados.
                        </p>
                    )}

                    {(() => {
                        // AJUSTE 29/09/2026 (a pedido do Dhiefferton): pra cada
                        // etiqueta da maquina, gera junto uma segunda etiqueta
                        // com NF/cliente/data - a unidade ganha um numero de
                        // serie NOSSO novo aqui, entao sem isso se perderia a
                        // referencia de qual nota/cliente ela veio.
                        //
                        // AJUSTE 01/10/2026 (1): a etiqueta de NF deixou de
                        // ser pareada 1-pra-1 com cada etiqueta de maquina -
                        // passou a sair só 1 vez por ITEM confirmado.
                        //
                        // AJUSTE 01/10/2026 (2, revisado no mesmo dia a
                        // pedido do Dhiefferton - "Quero 1 etiqueta para nf
                        // toda, não para cada item, essa etiqueta deve
                        // aparecer depois que fizer o recebimento da nota
                        // toda"): 1 por ITEM ainda duplicava a etiqueta de NF
                        // quando a nota tinha mais de 1 item (cada
                        // confirmação de item reimprimia a mesma etiqueta de
                        // NF). Agora a etiqueta de NF só entra na impressão
                        // quando `resultado.notaConcluida` vier true - ou
                        // seja, só na confirmação do ÚLTIMO item pendente da
                        // nota inteira (resultado.notaConcluida já existe no
                        // backend, ver PATCH /nf-devolucao/itens/:itemId/
                        // receber) - sai 1 única vez por NF, não por item.
                        // As etiquetas de MÁQUINA continuam saindo a cada
                        // item confirmado (cada item gera as suas, serial
                        // novo por unidade) - só a de NF que passou a
                        // depender da nota inteira estar concluída.
                        const seriesGeradas =
                            resultado.pickingConfirmado?.numerosSerieGerados ||
                            resultado.estoqueDevolucaoConfirmado?.numerosSerieGerados ||
                            [];
                        if (seriesGeradas.length === 0 && !resultado.notaConcluida) {
                            return null;
                        }
                        return (
                            <EtiquetasTermicas10x5
                                etiquetas={[
                                    ...seriesGeradas.map((serie) => ({
                                        tipo: 'default',
                                        sku: itemSelecionado.sku,
                                        descricao: itemSelecionado.descricao,
                                        codigoBarras: resultado.produtoCodigoBarras,
                                        numeroSerie: serie,
                                    })),
                                    ...(resultado.notaConcluida
                                        ? [
                                              {
                                                  tipo: 'nf',
                                                  numeroNF: notaSelecionada.numero,
                                                  cliente: notaSelecionada.cliente,
                                                  data: notaSelecionada.data,
                                              },
                                          ]
                                        : []),
                                ]}
                            />
                        );
                    })()}

                    <button className="primary" style={{ width: '100%', marginTop: 8 }} onClick={voltarParaItens}>
                        Voltar pros itens
                    </button>
                </>
            ) : (
                <>
                    <div className="card">
                        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Produto</p>
                        <p style={{ fontSize: 14, fontWeight: 600 }}>{itemSelecionado.sku}</p>
                        <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{itemSelecionado.descricao}</p>
                        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Falta confirmar: {falta}</p>
                    </div>

                    <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Bom pra revenda</label>
                    <input
                        type="number"
                        value={quantidadeBoaInput}
                        onChange={(e) => setQuantidadeBoaInput(e.target.value)}
                        style={{ textAlign: 'center', fontSize: 20 }}
                    />

                    <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Defeituoso / avariado</label>
                    <input
                        type="number"
                        value={quantidadeDefeituosaInput}
                        onChange={(e) => setQuantidadeDefeituosaInput(e.target.value)}
                        style={{ textAlign: 'center', fontSize: 20 }}
                    />

                    {passouDoEsperado && (
                        <p style={{ fontSize: 12, color: 'var(--danger-text)' }}>
                            A soma ({quantidadeTotal}) passa do que falta confirmar ({falta}).
                        </p>
                    )}

                    <button className="primary" disabled={!podeConfirmar} onClick={confirmarDevolucao}>
                        {confirmando ? 'Registrando...' : 'Confirmar devolução'}
                    </button>

                    {erro && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erro}</p>}
                </>
            )}
        </div>
    );
}
