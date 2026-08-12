import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import EtiquetasTermicas10x5 from '../components/EtiquetaTermica10x5.jsx';

const DEPOSITOS = ['Maquinas', 'Avarias', 'Verde', 'Vermelho', 'Amarelo'];

// Recebimento por NF de importacao - unico ponto de entrada do
// recebimento no coletor. Fluxo: escolhe a NF -> escolhe o item ->
// informa deposito e quantidade recebida agora -> se o produto for
// serializado, bipa a serie de cada maquina -> confirma. O backend
// (PATCH /nf-importacao/itens/:itemId/receber) divide automatico
// em pallets pela capacidade calculada (lastro x camadas), escolhe
// o endereco de cada um e gera a etiqueta propria - aqui so
// mostramos o resultado e imprimimos.
export default function NfImportacao() {
    const navigate = useNavigate();
    const [notas, setNotas] = useState(null);
    const [carregandoNotas, setCarregandoNotas] = useState(true);
    const [notaSelecionada, setNotaSelecionada] = useState(null);
    const [itens, setItens] = useState(null);
    const [carregandoItens, setCarregandoItens] = useState(false);
    const [itemSelecionado, setItemSelecionado] = useState(null);
    const [produtoItem, setProdutoItem] = useState(null);
    const [deposito, setDeposito] = useState(null);
    const [quantidadeInput, setQuantidadeInput] = useState('');
    const [seriesLidas, setSeriesLidas] = useState([]);
    const [serieInput, setSerieInput] = useState('');
    const [confirmando, setConfirmando] = useState(false);
    const [resultado, setResultado] = useState(null);
    const [erro, setErro] = useState(null);

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

    async function abrirItem(item) {
        setItemSelecionado(item);
        setDeposito(null);
        setQuantidadeInput(String(item.quantidadeEsperada - item.quantidadeRecebida));
        setSeriesLidas([]);
        setSerieInput('');
        setResultado(null);
        setErro(null);
        // Precisa saber se o produto e serializado (a NF nao traz
        // essa info, so o cadastro local do produto tem).
        try {
            const produto = await api.get(`/produtos/buscar?codigo=${encodeURIComponent(item.sku)}`);
            setProdutoItem(produto);
        } catch (e) {
            setProdutoItem(null);
            setErro(`Produto "${item.sku}" não está cadastrado no WMS - não é possível gerar pallet.`);
        }
    }

    function voltarParaItens() {
        setItemSelecionado(null);
        setProdutoItem(null);
        setResultado(null);
        setErro(null);
    }

    function adicionarSerie() {
        const codigo = serieInput.trim();
        if (!codigo) return;
        if (seriesLidas.includes(codigo)) {
            setErro(`Série "${codigo}" já foi bipada nesse recebimento.`);
            return;
        }
        setErro(null);
        setSeriesLidas((atual) => [...atual, codigo]);
        setSerieInput('');
    }

    const quantidade = Number(quantidadeInput) || 0;
    const precisaSeries = produtoItem?.serializado;
    const seriesCompletas = !precisaSeries || seriesLidas.length === quantidade;
    const podeConfirmar = deposito && quantidade > 0 && seriesCompletas && !confirmando;

    async function confirmarRecebimento() {
        setConfirmando(true);
        setErro(null);
        try {
            const resposta = await api.patch(`/nf-importacao/itens/${itemSelecionado.id}/receber`, {
                quantidade,
                deposito,
                numerosSerie: precisaSeries ? seriesLidas : undefined,
            });
            setResultado(resposta);
        } catch (e) {
            setErro(e.message);
        } finally {
            setConfirmando(false);
        }
    }

    // ------------------------------------------------------------
    // Tela 1: lista de NFs
    // ------------------------------------------------------------
    if (!notaSelecionada) {
        return (
            <div className="tela">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <button onClick={() => navigate('/')}>←</button>
                    <span className="badge accent">Recebimento por NF</span>
                </div>

                {carregandoNotas && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Consultando ZenERP...</p>}
                {erro && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erro}</p>}

                {notas && notas.length === 0 && (
                    <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nenhuma NF de importação encontrada.</p>
                )}

                {notas &&
                    notas.map((nota) => (
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
                            const etiquetaPallet = { tipo: 'pallet', etiquetaCodigo: p.etiquetaCodigo };
                            const etiquetaEndereco = {
                                tipo: 'endereco',
                                sku: itemSelecionado.sku,
                                descricao: itemSelecionado.descricao,
                                deposito,
                                etiquetaCodigo: p.etiquetaCodigo,
                                enderecoSugerido: p.enderecoSugerido,
                            };
                            return [etiquetaPallet, etiquetaEndereco];
                        })}
                    />

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

                            {precisaSeries && (
                                <>
                                    <div className="card">
                                        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Bipe o número de série de cada máquina</p>
                                        <p style={{ fontSize: 16, fontWeight: 600 }}>
                                            {seriesLidas.length} de {quantidade} lida(s)
                                        </p>
                                    </div>
                                    <input
                                        type="text"
                                        value={serieInput}
                                        onChange={(e) => setSerieInput(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && adicionarSerie()}
                                        placeholder="Bipe ou digite o número de série"
                                        style={{ width: '100%', textAlign: 'center' }}
                                        autoFocus
                                    />
                                    {seriesLidas.length > 0 && (
                                        <div className="card">
                                            {seriesLidas.map((s, i) => (
                                                <div
                                                    key={s}
                                                    style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}
                                                >
                                                    <span>{i + 1}. {s}</span>
                                                    <button
                                                        style={{ fontSize: 11, padding: '2px 8px' }}
                                                        onClick={() => setSeriesLidas((atual) => atual.filter((x) => x !== s))}
                                                    >
                                                        remover
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </>
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
