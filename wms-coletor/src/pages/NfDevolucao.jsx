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

    function abrirNota(nota) {
        setNotaSelecionada(nota);
        setItens(null);
        setErro(null);
        setCarregandoItens(true);
        api
            .get(`/nf-devolucao/${nota.id}/itens`)
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

                {notasFiltradas.map((nota) => (
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
                    <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Cliente</p>
                    <p style={{ fontSize: 14, fontWeight: 600 }}>{notaSelecionada.cliente}</p>
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
                                    {item.quantidadeRecebida} de {item.quantidadeEsperada} confirmado(s)
                                    {item.quantidadeBoa > 0 && ` · ${item.quantidadeBoa} boa(s)`}
                                    {item.quantidadeDefeituosa > 0 && ` · ${item.quantidadeDefeituosa} defeituosa(s)`}
                                    {completo ? ' · completo' : ''}
                                    {item.recebidoAutomaticamente ? ' · automático (sem cadastro/almoxarifado)' : ''}
                                </span>
                            </button>
                        );
                    })}
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

                    {resultado.pickingConfirmado?.numerosSerieGerados?.length > 0 && (
                        <EtiquetasTermicas10x5
                            etiquetas={resultado.pickingConfirmado.numerosSerieGerados.map((serie) => ({
                                tipo: 'default',
                                sku: itemSelecionado.sku,
                                descricao: itemSelecionado.descricao,
                                codigoBarras: resultado.produtoCodigoBarras,
                                numeroSerie: serie,
                            }))}
                        />
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
