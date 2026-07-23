import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import BipagemInput from '../components/BipagemInput.jsx';
import EtiquetasEmLote from '../components/EtiquetasEmLote.jsx';

const DEPOSITOS = ['Maquinas', 'Avarias', 'Verde', 'Vermelho', 'Amarelo'];

export default function Recebimento() {
    const navigate = useNavigate();
    const [deposito, setDeposito] = useState(null);
    const [modoIdentificacao, setModoIdentificacao] = useState(null);
    const [produto, setProduto] = useState(null);
    const [buscandoProduto, setBuscandoProduto] = useState(false);
    const [erroProduto, setErroProduto] = useState(null);
    const [handlingUnitCode, setHandlingUnitCode] = useState(null);
    const [quantidadeInput, setQuantidadeInput] = useState('');
    const [numeroPalletesInput, setNumeroPalletesInput] = useState('1');
    const [quantidadeConfirmada, setQuantidadeConfirmada] = useState(null);
    const [numeroPalletesConfirmado, setNumeroPalletesConfirmado] = useState(null);
    const [seriesLidas, setSeriesLidas] = useState([]);
    const [resultados, setResultados] = useState(null);
    const [mensagem, setMensagem] = useState(null);
    const [gerando, setGerando] = useState(false);

    const totalSeries = produto?.serializado ? Number(quantidadeConfirmada || 0) * Number(numeroPalletesConfirmado || 0) : 0;

    // Aceita tanto o SKU quanto o código de barras cadastrado no
    // produto - busca na API pra achar o produto de verdade, em
    // vez de aceitar qualquer texto bipado como se fosse o SKU.
    async function buscarProduto(codigo) {
        setBuscandoProduto(true);
        setErroProduto(null);
        try {
            const resultado = await api.get(`/produtos/buscar?codigo=${encodeURIComponent(codigo)}`);
            setProduto(resultado);
        } catch (e) {
            setErroProduto(`Não achei nenhum produto com esse código. Confira e bipe de novo.`);
        } finally {
            setBuscandoProduto(false);
        }
    }

    // Bipa o código do pallet (handling unit) impresso na etiqueta do
    // ZenERP - já traz produto, quantidade e séries prontos, sem
    // precisar bipar cada máquina manualmente depois.
    async function buscarPalletErp(codigo) {
        setBuscandoProduto(true);
        setErroProduto(null);
        try {
            const resposta = await api.get(`/recebimento/zenerp/${encodeURIComponent(codigo)}`);
            if (resposta.itens.length > 1) {
                setErroProduto('Esse pallet tem mais de um produto diferente no ERP - faça o recebimento manual pra esse caso.');
                return;
            }
            const item = resposta.itens[0];
            const produtoLocal = await api.get(`/produtos/buscar?codigo=${encodeURIComponent(item.sku)}`);

            if (produtoLocal.serializado && item.numerosSerie.length !== item.quantidade) {
                setErroProduto(
                    `O ERP não trouxe número de série pra todas as ${item.quantidade} unidade(s) desse pallet (só ${item.numerosSerie.length}). Faça manual ou confira o cadastro no ERP.`
                );
                return;
            }

            setProduto(produtoLocal);
            setQuantidadeConfirmada(String(item.quantidade));
            setNumeroPalletesConfirmado('1');
            setSeriesLidas(produtoLocal.serializado ? item.numerosSerie : []);
            setHandlingUnitCode(codigo);
        } catch (e) {
            setErroProduto(`Erro ao consultar o ERP: ${e.message}`);
        } finally {
            setBuscandoProduto(false);
        }
    }

    async function iniciarRecebimento() {
        setGerando(true);
        setMensagem(null);
        try {
            const numero = Number(numeroPalletesConfirmado);
            const numerosSerie = produto.serializado ? seriesLidas : undefined;
            if (numero > 1) {
                const resposta = await api.post('/recebimento/iniciar-lote', {
                    sku: produto.sku,
                    quantidade: Number(quantidadeConfirmada),
                    deposito,
                    numeroPalletes: numero,
                    numerosSerie,
                });
                setResultados(resposta.gerados);
                if (resposta.erroParcial) {
                    setMensagem(
                        `Gerado ${resposta.total} de ${resposta.solicitado} pallet(s). Parou por: ${resposta.erroParcial}`
                    );
                }
            } else {
                const resposta = await api.post('/recebimento/iniciar', {
                    sku: produto.sku,
                    quantidade: Number(quantidadeConfirmada),
                    deposito,
                    numerosSerie,
                });
                setResultados([resposta]);
            }
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        } finally {
            setGerando(false);
        }
    }

    function novoRecebimento() {
        setDeposito(null);
        setModoIdentificacao(null);
        setProduto(null);
        setErroProduto(null);
        setHandlingUnitCode(null);
        setQuantidadeInput('');
        setNumeroPalletesInput('1');
        setQuantidadeConfirmada(null);
        setNumeroPalletesConfirmado(null);
        setSeriesLidas([]);
        setResultados(null);
        setMensagem(null);
    }

    return (
        <div className="tela">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button onClick={() => navigate('/')}>←</button>
                <span className="badge warning">Novo recebimento</span>
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

            {deposito && !produto && !modoIdentificacao && (
                <>
                    <div className="card">
                        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Depósito</p>
                        <p style={{ fontSize: 16, fontWeight: 600 }}>{deposito}</p>
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Como vai identificar o produto?</p>
                    <button onClick={() => setModoIdentificacao('manual')}>Bipar SKU ou código de barras</button>
                    <button onClick={() => setModoIdentificacao('erp')}>Bipar pallet do ERP</button>
                </>
            )}

            {deposito && !produto && modoIdentificacao === 'manual' && (
                <>
                    <div className="card">
                        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Depósito</p>
                        <p style={{ fontSize: 16, fontWeight: 600 }}>{deposito}</p>
                    </div>
                    <BipagemInput label="Bipar SKU ou código de barras do produto" onBipar={buscarProduto} />
                    {buscandoProduto && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Buscando...</p>}
                    {erroProduto && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erroProduto}</p>}
                    <button onClick={() => setModoIdentificacao(null)}>← Trocar forma de identificação</button>
                </>
            )}

            {deposito && !produto && modoIdentificacao === 'erp' && (
                <>
                    <div className="card">
                        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Depósito</p>
                        <p style={{ fontSize: 16, fontWeight: 600 }}>{deposito}</p>
                    </div>
                    <BipagemInput label="Bipar código do pallet (handling unit) do ERP" onBipar={buscarPalletErp} />
                    {buscandoProduto && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Consultando ZenERP...</p>}
                    {erroProduto && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erroProduto}</p>}
                    <button onClick={() => setModoIdentificacao(null)}>← Trocar forma de identificação</button>
                </>
            )}

            {deposito && produto && !quantidadeConfirmada && (
                <>
                    <div className="card">
                        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Produto identificado</p>
                        <p style={{ fontSize: 16, fontWeight: 600 }}>{produto.sku}</p>
                        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{produto.descricao}</p>
                        <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Depósito: {deposito}</p>
                    </div>

                    <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Quantidade em CADA pallet</label>
                    <input
                        type="number"
                        value={quantidadeInput}
                        onChange={(e) => setQuantidadeInput(e.target.value)}
                        style={{ textAlign: 'center', fontSize: 20 }}
                    />

                    <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Quantos pallets iguais chegaram?</label>
                    <input
                        type="number"
                        value={numeroPalletesInput}
                        onChange={(e) => setNumeroPalletesInput(e.target.value)}
                        style={{ textAlign: 'center', fontSize: 20 }}
                    />

                    <button
                        className="primary"
                        disabled={!quantidadeInput || !numeroPalletesInput}
                        onClick={() => {
                            setQuantidadeConfirmada(quantidadeInput);
                            setNumeroPalletesConfirmado(numeroPalletesInput);
                        }}
                    >
                        Confirmar
                    </button>
                </>
            )}

            {deposito && produto && quantidadeConfirmada && produto.serializado && seriesLidas.length < totalSeries && (
                <>
                    <div className="card">
                        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Bipe o número de série de cada máquina</p>
                        <p style={{ fontSize: 16, fontWeight: 600 }}>
                            {seriesLidas.length} de {totalSeries} lida(s)
                        </p>
                    </div>
                    <BipagemInput
                        label="Bipar número de série da máquina"
                        onBipar={(codigo) => {
                            if (seriesLidas.includes(codigo)) {
                                setMensagem(`Série "${codigo}" já foi bipada nesse recebimento.`);
                                return;
                            }
                            setMensagem(null);
                            setSeriesLidas((atual) => [...atual, codigo]);
                        }}
                    />
                    {seriesLidas.length > 0 && (
                        <div className="card">
                            {seriesLidas.map((s, i) => (
                                <div
                                    key={s}
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        fontSize: 13,
                                        padding: '4px 0',
                                    }}
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

            {deposito && produto && quantidadeConfirmada && (!produto.serializado || seriesLidas.length === totalSeries) && !resultados && (
                <div className="card">
                    <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Resumo</p>
                    <p style={{ fontSize: 13 }}>
                        {produto.sku} · {quantidadeConfirmada} un. cada · {numeroPalletesConfirmado} pallet(s) · {deposito}
                        {produto.serializado && ` · ${totalSeries} série(s) bipada(s)`}
                        {handlingUnitCode && ` · pallet ERP ${handlingUnitCode}`}
                    </p>
                    <button className="primary" style={{ width: '100%', marginTop: 8 }} disabled={gerando} onClick={iniciarRecebimento}>
                        {gerando ? 'Gerando...' : 'Gerar etiqueta(s) e sugerir endereço(s)'}
                    </button>
                </div>
            )}

            {resultados && (
                <>
                    <div className="card" style={{ background: 'var(--success-bg)' }}>
                        <p style={{ fontSize: 11, color: 'var(--success-text)' }}>
                            {resultados.length > 1 ? `${resultados.length} endereços gerados` : 'Endereço sugerido'}
                        </p>
                        {resultados.map((r) => (
                            <p key={r.palletId} style={{ fontSize: resultados.length > 1 ? 14 : 18, fontWeight: 600, color: 'var(--success-text)' }}>
                                {r.enderecoSugerido}
                            </p>
                        ))}
                    </div>

                    <EtiquetasEmLote
                        etiquetas={resultados.flatMap((r, i) => {
                            const etiquetaPallet = {
                                sku: produto.sku,
                                descricao: produto.descricao,
                                quantidade: quantidadeConfirmada,
                                deposito,
                                enderecoSugerido: r.enderecoSugerido,
                                etiquetaCodigo: r.etiquetaCodigo,
                            };
                            if (!produto.serializado) return [etiquetaPallet];

                            // Reconstrói qual fatia de séries foi pra esse pallet
                            // específico - mesma lógica de fatiamento que a API
                            // usa no /iniciar-lote (quantidade × índice do pallet).
                            const seriesDessePallet = seriesLidas.slice(
                                i * Number(quantidadeConfirmada),
                                (i + 1) * Number(quantidadeConfirmada)
                            );
                            return [
                                etiquetaPallet,
                                ...seriesDessePallet.map((serie) => ({ ...etiquetaPallet, numeroSerie: serie })),
                            ];
                        })}
                    />

                    <button className="primary" style={{ width: '100%', marginTop: 8 }} onClick={novoRecebimento}>
                        Concluir e iniciar próximo recebimento
                    </button>
                </>
            )}

            {mensagem && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{mensagem}</p>}
        </div>
    );
}
