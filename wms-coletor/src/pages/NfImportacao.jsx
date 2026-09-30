import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import EtiquetasTermicas10x5 from '../components/EtiquetaTermica10x5.jsx';

const DEPOSITOS = ['Maquinas', 'Avarias', 'Verde', 'Vermelho', 'Amarelo'];

// Recebimento por NF de importacao - unico ponto de entrada do
// recebimento no coletor. Fluxo: escolhe a NF -> escolhe o item ->
// informa deposito e quantidade recebida agora -> confirma. O
// backend (PATCH /nf-importacao/itens/:itemId/receber) divide
// automatico em pallets pela capacidade calculada (lastro x
// camadas), escolhe o endereco de cada um, gera a etiqueta propria
// e - pra produto serializado - ja gera o numero de serie de cada
// maquina sozinho (nao e mais a serie real do fabricante, e um
// codigo nosso, estavel e unico por unidade). O operador nao bipa
// nada aqui - so confirma e imprime as etiquetas geradas.
export default function NfImportacao() {
    const navigate = useNavigate();
    const [notas, setNotas] = useState(null);
    const [carregandoNotas, setCarregandoNotas] = useState(true);
    const [filtro, setFiltro] = useState('');
    const [notaSelecionada, setNotaSelecionada] = useState(null);
    const [itens, setItens] = useState(null);
    const [carregandoItens, setCarregandoItens] = useState(false);
    const [itemSelecionado, setItemSelecionado] = useState(null);
    const [deposito, setDeposito] = useState(null);
    const [quantidadeInput, setQuantidadeInput] = useState('');
    // paraPulmaoTeste (30/09/2026, a pedido do Dhiefferton): opção de
    // mandar essa máquina pro Pulmão Teste em vez do vertical, quando
    // ela precisa ser testada antes de subir - mesma área do Estoque
    // Pulmão de sempre, só que não entra sozinha na fila automática
    // pro vertical até alguém aprovar o teste (tela Estoque Pulmão, no
    // dashboard).
    const [paraPulmaoTeste, setParaPulmaoTeste] = useState(false);
    const [confirmando, setConfirmando] = useState(false);
    const [resultado, setResultado] = useState(null);
    const [erro, setErro] = useState(null);
    const [retirando, setRetirando] = useState(false);
    const [retiradoInfo, setRetiradoInfo] = useState(null);
    // CORRIGIDO (27/09/2026, a pedido do Dhiefferton - "deixe com a opção
    // de mostrar e não mostrar os arquivados"): a seção de arquivadas
    // começa escondida (só o título com a contagem aparece) - um clique
    // no título mostra a lista, outro clique esconde de novo.
    const [mostrarArquivadas, setMostrarArquivadas] = useState(false);

    useEffect(() => {
        carregarNotas();
    }, []);

    function carregarNotas() {
        setCarregandoNotas(true);
        api
            .get('/nf-importacao')
            .then(setNotas)
            .catch((e) => setErro(e.message))
            .finally(() => setCarregandoNotas(false));
    }

    function abrirNota(nota) {
        setNotaSelecionada(nota);
        setItens(null);
        setErro(null);
        setCarregandoItens(true);
        api
            .get(`/nf-importacao/${nota.id}/itens`)
            .then((resposta) => setItens(resposta.itens))
            .catch((e) => setErro(e.message))
            .finally(() => setCarregandoItens(false));
    }

    function voltarParaNotas() {
        setNotaSelecionada(null);
        setItens(null);
        setItemSelecionado(null);
        setErro(null);
        carregarNotas();
    }

    function abrirItem(item) {
        setItemSelecionado(item);
        setDeposito(null);
        setQuantidadeInput(String(item.quantidadeEsperada - item.quantidadeRecebida));
        setParaPulmaoTeste(false);
        setResultado(null);
        setErro(null);
    }

    function voltarParaItens() {
        setItemSelecionado(null);
        setResultado(null);
        setErro(null);
        setRetiradoInfo(null);
    }

    const quantidade = Number(quantidadeInput) || 0;
    const podeConfirmar = deposito && quantidade > 0 && !confirmando;

    async function confirmarRecebimento() {
        setConfirmando(true);
        setErro(null);
        try {
            const resposta = await api.patch(`/nf-importacao/itens/${itemSelecionado.id}/receber`, {
                quantidade,
                deposito,
                paraPulmaoTeste,
            });
            setResultado(resposta);
        } catch (e) {
            setErro(e.message);
        } finally {
            setConfirmando(false);
        }
    }

    // Tira a linha de estoque correspondente do endereço RECEBIMENTO
    // no ZenERP (jogando pra MAQ) - o mesmo passo manual ("Alterar
    // estoque") que o time sempre teve que fazer lá depois de cada
    // recebimento. Best-effort: se der errado, mostra o erro real do
    // Zen e o operador move manualmente dessa vez (não desfaz nada do
    // recebimento, que já terminou).
    async function retirarDoRecebimento() {
        setRetirando(true);
        setRetiradoInfo(null);
        try {
            const resposta = await api.post(`/nf-importacao/itens/${itemSelecionado.id}/retirar-do-recebimento`, {
                quantidade,
            });
            setRetiradoInfo({ ok: true, mensagem: `Retirado do Recebimento - movido pro endereço ${resposta.enderecoFinal} no ZenERP.` });
        } catch (e) {
            setRetiradoInfo({ ok: false, mensagem: e.message });
        } finally {
            setRetirando(false);
        }
    }

    // ------------------------------------------------------------
    // Tela 1: lista de NFs
    // ------------------------------------------------------------
    if (!notaSelecionada) {
        const termo = filtro.trim().toLowerCase();
        const notasFiltradas = notas
            ? notas.filter(
                  (nota) =>
                      // numero vem como numero do ZenERP (nota.number), nao
                      // string - precisa converter antes de comparar, senao
                      // quebra a tela inteira (.toLowerCase nao existe em
                      // number).
                      String(nota.numero ?? '').toLowerCase().includes(termo) ||
                      String(nota.fornecedor ?? '').toLowerCase().includes(termo)
              )
            : [];
        // CORRIGIDO (27/09/2026, a pedido do Dhiefferton - "sempre
        // arquivar os que já foram concluídos"): mesmo padrão de
        // Devolução por NF (NfDevolucao.jsx) - concluída (arquivada=true,
        // vindo do backend) vai numa seção separada no fim da lista, pra
        // não competir com as pendentes/em andamento.
        const notasAtivas = notasFiltradas.filter((nota) => !nota.arquivada);
        const notasArquivadas = notasFiltradas.filter((nota) => nota.arquivada);

        return (
            <div className="tela">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <button onClick={() => navigate('/')}>←</button>
                    <span className="badge accent">Recebimento por NF</span>
                </div>

                <input
                    type="text"
                    placeholder="Buscar por número da NF ou fornecedor"
                    value={filtro}
                    onChange={(e) => setFiltro(e.target.value)}
                />

                {carregandoNotas && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Consultando ZenERP...</p>}
                {erro && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erro}</p>}

                {notas && notas.length === 0 && (
                    <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nenhuma NF de importação encontrada.</p>
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
                                className={`badge ${nota.statusRecebimento === 'concluida' ? 'success' : 'warning'}`}
                                style={{ fontSize: 11 }}
                            >
                                {nota.statusRecebimento}
                            </span>
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{nota.fornecedor}</span>
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
                                        {nota.statusRecebimento}
                                    </span>
                                </div>
                                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{nota.fornecedor}</span>
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
        return (
            <div className="tela">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <button onClick={voltarParaNotas}>←</button>
                    <span className="badge accent">NF {notaSelecionada.numero}</span>
                </div>

                <div className="card">
                    <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Fornecedor</p>
                    <p style={{ fontSize: 14, fontWeight: 600 }}>{notaSelecionada.fornecedor}</p>
                </div>

                {carregandoItens && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Carregando itens...</p>}
                {erro && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erro}</p>}

                {itens &&
                    itens.map((item) => {
                        const completo = item.quantidadeRecebida >= item.quantidadeEsperada;
                        return (
                            <button
                                key={item.id}
                                disabled={completo}
                                onClick={() => abrirItem(item)}
                                style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, opacity: completo ? 0.5 : 1 }}
                            >
                                <span style={{ fontWeight: 600 }}>{item.sku}</span>
                                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.descricao}</span>
                                <span style={{ fontSize: 12, color: completo ? 'var(--success-text)' : 'var(--text-muted)' }}>
                                    {item.quantidadeRecebida} de {item.quantidadeEsperada} recebido(s)
                                    {completo ? ' · completo' : ''}
                                    {item.recebidoAutomaticamente ? ' · peça (automático)' : ''}
                                </span>
                            </button>
                        );
                    })}
            </div>
        );
    }

    // ------------------------------------------------------------
    // Tela 3: receber o item selecionado
    // ------------------------------------------------------------
    return (
        <div className="tela">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button onClick={voltarParaItens}>←</button>
                <span className="badge accent">{itemSelecionado.sku}</span>
            </div>

            {resultado ? (
                <>
                    <div className="card" style={{ background: 'var(--success-bg)' }}>
                        <p style={{ fontSize: 11, color: 'var(--success-text)' }}>
                            {resultado.palletsGerados.length > 1
                                ? `${resultado.palletsGerados.length} pallets gerados`
                                : 'Pallet gerado'}
                        </p>
                        {resultado.palletsGerados.map((p) => (
                            <p key={p.palletId} style={{ fontSize: 14, fontWeight: 600, color: 'var(--success-text)' }}>
                                {p.enderecoSugerido}
                                {p.numerosSerieGerados?.length > 0 && ` · ${p.numerosSerieGerados.length} série(s)`}
                            </p>
                        ))}
                        {resultado.notaConcluida && (
                            <p style={{ fontSize: 12, color: 'var(--success-text)', marginTop: 4 }}>
                                NF concluída - todos os itens foram recebidos.
                            </p>
                        )}
                    </div>

                    <EtiquetasTermicas10x5
                        etiquetas={resultado.palletsGerados.flatMap((p) => {
                            // Nao gera mais a etiqueta "PALETE" separada -
                            // ela usava o mesmo codigo da etiqueta de
                            // endereco (abaixo), so que com menos
                            // informacao. Redundante: 1 etiqueta por
                            // pallet basta.
                            const etiquetaEndereco = {
                                tipo: 'endereco',
                                sku: itemSelecionado.sku,
                                descricao: itemSelecionado.descricao,
                                // Quantidade DESSE pallet (11/09/2026) - o
                                // backend agora devolve isso por pallet
                                // (p.quantidade); antes faltava aqui, e a
                                // etiqueta impressa nunca mostrava "Qtd:"
                                // pra recebimento por NF.
                                quantidade: p.quantidade,
                                deposito,
                                etiquetaCodigo: p.etiquetaCodigo,
                                enderecoSugerido: p.enderecoSugerido,
                            };
                            // Produto serializado: uma etiqueta por maquina, com
                            // o numero de serie que o proprio sistema gerou -
                            // esse numero e o que vai ser bipado depois na
                            // separacao, entao a etiqueta precisa estar na caixa
                            // de cada maquina antes de guardar.
                            const etiquetasSerie = (p.numerosSerieGerados || []).map((serie) => ({
                                tipo: 'default',
                                sku: itemSelecionado.sku,
                                descricao: itemSelecionado.descricao,
                                codigoBarras: resultado.produtoCodigoBarras,
                                numeroSerie: serie,
                                enderecoSugerido: p.enderecoSugerido,
                            }));
                            return [etiquetaEndereco, ...etiquetasSerie];
                        })}
                    />

                    <button
                        style={{ width: '100%', marginTop: 8 }}
                        disabled={retirando || retiradoInfo?.ok}
                        onClick={retirarDoRecebimento}
                    >
                        {retirando ? 'Retirando do Recebimento...' : retiradoInfo?.ok ? 'Retirado do Recebimento ✓' : 'Retirar do Recebimento'}
                    </button>
                    {retiradoInfo && !retiradoInfo.ok && (
                        <p style={{ fontSize: 12, color: 'var(--danger-text)', marginTop: 4 }}>{retiradoInfo.mensagem}</p>
                    )}

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
                        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            Falta receber: {itemSelecionado.quantidadeEsperada - itemSelecionado.quantidadeRecebida}
                        </p>
                    </div>

                    {!deposito && (
                        <>
                            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Para qual depósito vai?</p>
                            {DEPOSITOS.map((d) => (
                                <button key={d} onClick={() => setDeposito(d)}>
                                    {d}
                                </button>
                            ))}
                        </>
                    )}

                    {deposito && (
                        <>
                            <div className="card">
                                <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Depósito</p>
                                <p style={{ fontSize: 14, fontWeight: 600 }}>{deposito}</p>
                            </div>

                            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Quantidade recebida agora</label>
                            <input
                                type="number"
                                value={quantidadeInput}
                                onChange={(e) => setQuantidadeInput(e.target.value)}
                                style={{ textAlign: 'center', fontSize: 20 }}
                            />

                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', margin: '10px 0' }}>
                                <input
                                    type="checkbox"
                                    checked={paraPulmaoTeste}
                                    onChange={(e) => setParaPulmaoTeste(e.target.checked)}
                                />
                                Precisa testar antes de subir (Pulmão Teste)
                            </label>
                            {paraPulmaoTeste && (
                                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 10px' }}>
                                    Vai direto pro Pulmão Teste (sem endereço no vertical) - só sobe depois que alguém
                                    aprovar o teste na tela de Estoque Pulmão.
                                </p>
                            )}

                            <button className="primary" disabled={!podeConfirmar} onClick={confirmarRecebimento}>
                                {confirmando ? 'Gerando pallet(s)...' : 'Confirmar recebimento'}
                            </button>
                        </>
                    )}

                    {erro && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erro}</p>}
                </>
            )}
        </div>
    );
}