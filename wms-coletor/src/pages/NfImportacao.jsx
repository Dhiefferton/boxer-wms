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
    const [notaSelecionada, setNotaSelecionada] = useState(null);
    const [itens, setItens] = useState(null);
    const [carregandoItens, setCarregandoItens] = useState(false);
    const [itemSelecionado, setItemSelecionado] = useState(null);
    const [deposito, setDeposito] = useState(null);
    const [quantidadeInput, setQuantidadeInput] = useState('');
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

    function abrirItem(item) {
        setItemSelecionado(item);
        setDeposito(null);
        setQuantidadeInput(String(item.quantidadeEsperada - item.quantidadeRecebida));
        setResultado(null);
        setErro(null);
    }

    function voltarParaItens() {
        setItemSelecionado(null);
        setResultado(null);
        setErro(null);
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
                            const etiquetaPallet = { tipo: 'pallet', etiquetaCodigo: p.etiquetaCodigo };
                            const etiquetaEndereco = {
                                tipo: 'endereco',
                                sku: itemSelecionado.sku,
                                descricao: itemSelecionado.descricao,
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
                                numeroSerie: serie,
                                enderecoSugerido: p.enderecoSugerido,
                            }));
                            return [etiquetaPallet, etiquetaEndereco, ...etiquetasSerie];
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
