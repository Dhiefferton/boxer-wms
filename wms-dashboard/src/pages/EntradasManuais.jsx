import { useEffect, useState } from 'react';
import { api } from '../api';
import EtiquetasEmLote from '../components/EtiquetasEmLote.jsx';
import { useDefinirTitulo } from '../contexts/TituloPaginaContext.jsx';

const DEPOSITOS = ['Maquinas', 'Avarias', 'Verde', 'Vermelho', 'Amarelo'];

export default function EntradasManuais() {
    useDefinirTitulo('Entradas manuais');
    const [produtos, setProdutos] = useState([]);

    // --- Entrada no vertical ---
    const [buscaVertical, setBuscaVertical] = useState('');
    const [enderecosLivres, setEnderecosLivres] = useState([]);
    const [entradaVertical, setEntradaVertical] = useState({
        produtoId: '',
        deposito: DEPOSITOS[0],
        quantidade: '',
        numeroPalletes: '1',
        enderecoId: '',
    });
    const [lancandoVertical, setLancandoVertical] = useState(false);
    const [mensagemVertical, setMensagemVertical] = useState(null);
    const [etiquetasGeradas, setEtiquetasGeradas] = useState(null);
    const [buscaEndereco, setBuscaEndereco] = useState('');

    const produtoSelecionadoVertical = produtos.find((p) => p.id === entradaVertical.produtoId);

    useEffect(() => {
        api.get('/produtos').then((lista) => {
            setProdutos(lista);
            setEntradaVertical((atual) => ({ ...atual, produtoId: atual.produtoId || lista[0]?.id || '' }));
        });
        api.get('/enderecos/mapa').then((lista) => {
            setEnderecosLivres(
                lista
                    // Andar 1 e reservado (picking / estoque flutuante) -
                    // recebimento nunca guarda pallet novo la, entao nem
                    // aparece como opcao aqui pra escolher manualmente.
                    .filter((e) => e.status === 'livre' && Number(e.andar) !== 1)
                    .sort((a, b) => a.codigo.localeCompare(b.codigo))
            );
        });
    }, []);

    function filtrarProdutos(busca) {
        if (!busca) return produtos;
        const termo = busca.toLowerCase();
        return produtos.filter(
            (p) => p.sku.toLowerCase().includes(termo) || p.descricao.toLowerCase().includes(termo)
        );
    }

    function filtrarEnderecos(busca) {
        if (!busca) return enderecosLivres;
        const termo = busca.toLowerCase();
        return enderecosLivres.filter((e) => e.codigo.toLowerCase().includes(termo));
    }

    // Mesmo problema/solução do produto (comentário abaixo): sem
    // isso, digitar na busca só filtra a lista por baixo dos panos -
    // o <select> fechado continua mostrando "Automático" até o
    // usuário abrir o dropdown na mão, parecendo que a busca não fez
    // nada. Ao digitar, já seleciona o primeiro endereço que bate;
    // campo vazio volta pro automático.
    function aoBuscarEndereco(texto) {
        setBuscaEndereco(texto);
        if (!texto.trim()) {
            setEntradaVertical((atual) => ({ ...atual, enderecoId: '' }));
            return;
        }
        const filtrados = filtrarEnderecos(texto);
        setEntradaVertical((atual) => ({ ...atual, enderecoId: filtrados[0]?.id || '' }));
    }

    // Toda vez que a busca muda, a lista do <select> muda junto - e
    // se a gente não atualizar o produto selecionado pra bater com
    // o que está sendo mostrado, o sistema manda o produto ANTIGO
    // (de antes de filtrar), mesmo a tela mostrando outro. Por isso
    // sempre que busca muda, já seleciona o primeiro item filtrado.
    function aoBuscarVertical(texto) {
        setBuscaVertical(texto);
        const filtrados = filtrarProdutos(texto);
        setEntradaVertical((atual) => ({ ...atual, produtoId: filtrados[0]?.id || '' }));
    }

    async function lancarEntradaVertical() {
        const produto = produtos.find((p) => p.id === entradaVertical.produtoId);
        if (!produto) return;

        setLancandoVertical(true);
        setMensagemVertical(null);
        setEtiquetasGeradas(null);
        try {
            const numero = Number(entradaVertical.numeroPalletes) || 1;

            // Números de série de máquina são sempre gerados pelo
            // próprio backend (sequence numero_serie_recebimento_seq,
            // ver criarPalletRecebimento em recebimento.js) - o
            // operador não digita nada, só usa o que volta em
            // numerosSerieGerados pra montar as etiquetas.
            if (numero > 1) {
                const resposta = await api.post('/recebimento/iniciar-lote', {
                    sku: produto.sku,
                    quantidade: Number(entradaVertical.quantidade),
                    deposito: entradaVertical.deposito,
                    numeroPalletes: numero,
                });
                setMensagemVertical(
                    resposta.erroParcial
                        ? `Gerado ${resposta.total} de ${resposta.solicitado} pallet(s). Parou por: ${resposta.erroParcial}`
                        : `${resposta.total} pallet(s) lançado(s).`
                );
                setEtiquetasGeradas(
                    resposta.gerados.flatMap((r) => {
                        const etiquetaPallet = {
                            sku: produto.sku,
                            descricao: produto.descricao,
                            quantidade: entradaVertical.quantidade,
                            deposito: entradaVertical.deposito,
                            enderecoSugerido: r.enderecoSugerido,
                            etiquetaCodigo: r.etiquetaCodigo,
                        };
                        if (!produto.serializado) return [etiquetaPallet];
                        return [
                            etiquetaPallet,
                            ...(r.numerosSerieGerados || []).map((serie) => ({ ...etiquetaPallet, numeroSerie: serie })),
                        ];
                    })
                );
            } else {
                const resposta = await api.post('/recebimento/iniciar', {
                    sku: produto.sku,
                    quantidade: Number(entradaVertical.quantidade),
                    deposito: entradaVertical.deposito,
                    enderecoId: entradaVertical.enderecoId || undefined,
                });
                setMensagemVertical(`Lançado em ${resposta.enderecoSugerido}.`);
                const etiquetaPallet = {
                    sku: produto.sku,
                    descricao: produto.descricao,
                    quantidade: entradaVertical.quantidade,
                    deposito: entradaVertical.deposito,
                    enderecoSugerido: resposta.enderecoSugerido,
                    etiquetaCodigo: resposta.etiquetaCodigo,
                };
                setEtiquetasGeradas(
                    produto.serializado
                        ? [etiquetaPallet, ...(resposta.numerosSerieGerados || []).map((serie) => ({ ...etiquetaPallet, numeroSerie: serie }))]
                        : [etiquetaPallet]
                );
                setEnderecosLivres((atual) => atual.filter((e) => e.id !== resposta.enderecoId));
            }

            setEntradaVertical((atual) => ({ ...atual, quantidade: '', numeroPalletes: '1', enderecoId: '' }));
            setBuscaEndereco('');
        } catch (e) {
            setMensagemVertical(`Erro: ${e.message}`);
        } finally {
            setLancandoVertical(false);
        }
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 104px)' }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', maxWidth: 480, width: '100%', gap: 16 }}>
                <div className="card">
                    <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Vertical (armazenagem)</p>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
                        Cria um pallet novo direto num endereço livre - o sistema escolhe automaticamente.
                    </p>

                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Produto</label>
                    <input
                        type="text"
                        placeholder="Buscar por código ou descrição"
                        value={buscaVertical}
                        onChange={(e) => aoBuscarVertical(e.target.value)}
                        style={{ width: '100%', margin: '4px 0 6px' }}
                    />
                    <select
                        value={entradaVertical.produtoId}
                        onChange={(e) => setEntradaVertical({ ...entradaVertical, produtoId: e.target.value })}
                        style={{ width: '100%', margin: '0 0 10px' }}
                    >
                        {filtrarProdutos(buscaVertical).map((p) => (
                            <option key={p.id} value={p.id}>{p.sku} · {p.descricao}</option>
                        ))}
                    </select>

                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Depósito</label>
                    <select
                        value={entradaVertical.deposito}
                        onChange={(e) => setEntradaVertical({ ...entradaVertical, deposito: e.target.value })}
                        style={{ width: '100%', margin: '4px 0 10px' }}
                    >
                        {DEPOSITOS.map((d) => (
                            <option key={d} value={d}>{d}</option>
                        ))}
                    </select>

                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Quantos pallets iguais?</label>
                    <input
                        type="number"
                        value={entradaVertical.numeroPalletes}
                        onChange={(e) => {
                            setEntradaVertical({ ...entradaVertical, numeroPalletes: e.target.value, enderecoId: '' });
                            setBuscaEndereco('');
                        }}
                        style={{ width: '100%', margin: '4px 0 10px' }}
                    />

                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Endereço</label>
                    <input
                        type="text"
                        placeholder="Buscar por código do endereço"
                        value={buscaEndereco}
                        disabled={Number(entradaVertical.numeroPalletes) > 1}
                        onChange={(e) => aoBuscarEndereco(e.target.value)}
                        style={{ width: '100%', margin: '4px 0 6px' }}
                    />
                    <select
                        value={entradaVertical.enderecoId}
                        disabled={Number(entradaVertical.numeroPalletes) > 1}
                        onChange={(e) => setEntradaVertical({ ...entradaVertical, enderecoId: e.target.value })}
                        style={{ width: '100%', margin: '0 0 4px' }}
                    >
                        <option value="">Automático (posição livre mais próxima)</option>
                        {filtrarEnderecos(buscaEndereco).map((e) => (
                            <option key={e.id} value={e.id}>{e.codigo}</option>
                        ))}
                    </select>
                    {Number(entradaVertical.numeroPalletes) > 1 && (
                        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 6px' }}>
                            Com mais de 1 pallet, o endereço é sempre automático (cada um pega uma posição diferente).
                        </p>
                    )}

                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Quantidade</label>
                    <input
                        type="number"
                        value={entradaVertical.quantidade}
                        onChange={(e) => setEntradaVertical({ ...entradaVertical, quantidade: e.target.value })}
                        style={{ width: '100%', margin: '4px 0 12px' }}
                    />

                    {produtoSelecionadoVertical?.serializado && (
                        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 12px' }}>
                            Produto serializado — o número de série de cada unidade é gerado automaticamente pelo sistema ao lançar.
                        </p>
                    )}

                    <button
                        className="primary"
                        style={{ width: '100%' }}
                        disabled={lancandoVertical || !entradaVertical.produtoId || !entradaVertical.quantidade}
                        onClick={lancarEntradaVertical}
                    >
                        {lancandoVertical ? 'Lançando...' : 'Lançar entrada'}
                    </button>

                    {mensagemVertical && <p style={{ fontSize: 12, marginTop: 8 }}>{mensagemVertical}</p>}
                    {etiquetasGeradas && <EtiquetasEmLote etiquetas={etiquetasGeradas} />}
                </div>
            </div>
            </div>
        </div>
    );
}
