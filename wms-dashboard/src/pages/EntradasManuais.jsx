import { useEffect, useState } from 'react';
import { api } from '../api';
import EtiquetasTermicas10x5 from '../components/EtiquetaTermica10x5.jsx';
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

    // --- Entrada em lote por intervalo de endereço ---
    // Lança um pallet novo em CADA endereço livre dentro de um bloco
    // de prédio x andar (ex.: do R5-A-A2 até R5-F-A5) - não é
    // reimpressão, é lançamento de entrada mesmo (gera os números de
    // série automaticamente, igual à entrada normal). Por isso
    // precisa do mapa completo (todos os status, não só livre): os
    // prédios/andares do intervalo vêm de lá, e os endereços já
    // ocupados/bloqueados no meio do bloco são identificados e
    // ignorados (não travam o lote inteiro).
    const [enderecosMapa, setEnderecosMapa] = useState([]);
    const [buscaProdutoLote, setBuscaProdutoLote] = useState('');
    const [produtoIdLote, setProdutoIdLote] = useState('');
    const [depositoLote, setDepositoLote] = useState(DEPOSITOS[0]);
    const [quantidadeLote, setQuantidadeLote] = useState('');
    const [ruaLote, setRuaLote] = useState('');
    const [prediosDeLote, setPrediosDeLote] = useState('');
    const [prediosAteLote, setPrediosAteLote] = useState('');
    const [andarDeLote, setAndarDeLote] = useState('');
    const [andarAteLote, setAndarAteLote] = useState('');
    const [lancandoLote, setLancandoLote] = useState(false);
    const [etiquetasLote, setEtiquetasLote] = useState(null);
    const [mensagemLote, setMensagemLote] = useState(null);

    const produtoSelecionadoVertical = produtos.find((p) => p.id === entradaVertical.produtoId);

    // Recarrega o mapa completo de endereços - usado no load inicial
    // e de novo depois de qualquer lançamento (pra os endereços que
    // acabaram de ser ocupados já saírem da lista de livres, tanto no
    // <select> da entrada única quanto no cálculo do intervalo em
    // lote). Mantém a rua escolhida no intervalo quando ela ainda
    // existir na lista nova.
    function recarregarEnderecos() {
        return api.get('/enderecos/mapa').then((lista) => {
            setEnderecosMapa(lista);
            const ruas = [...new Set(lista.map((e) => e.rua))].sort();
            setRuaLote((atual) => (atual && ruas.includes(atual) ? atual : ruas[0] || ''));
            setEnderecosLivres(
                lista
                    // Andar 1 e reservado (picking / estoque flutuante) -
                    // recebimento nunca guarda pallet novo la, entao nem
                    // aparece como opcao aqui pra escolher manualmente.
                    .filter((e) => e.status === 'livre' && Number(e.andar) !== 1)
                    .sort((a, b) => a.codigo.localeCompare(b.codigo))
            );
            return lista;
        });
    }

    useEffect(() => {
        api.get('/produtos').then((lista) => {
            setProdutos(lista);
            setEntradaVertical((atual) => ({ ...atual, produtoId: atual.produtoId || lista[0]?.id || '' }));
            setProdutoIdLote((atual) => atual || lista[0]?.id || '');
        });
        recarregarEnderecos();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Troca de rua invalida os prédios/andares escolhidos no
    // intervalo (predio "A" de uma rua não é a mesma posição física
    // de "A" em outra) - limpa pra não gerar etiqueta do intervalo
    // errado sem querer.
    useEffect(() => {
        setPrediosDeLote('');
        setPrediosAteLote('');
        setAndarDeLote('');
        setAndarAteLote('');
        setEtiquetasLote(null);
        setMensagemLote(null);
    }, [ruaLote]);

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

    // Mesmo padrão de busca-com-auto-seleção do produto da entrada
    // única (aoBuscarVertical acima), só que pro produto do lote por
    // intervalo.
    function aoBuscarProdutoLote(texto) {
        setBuscaProdutoLote(texto);
        const filtrados = filtrarProdutos(texto);
        setProdutoIdLote(filtrados[0]?.id || '');
    }

    // Mesmo formato de etiqueta usado no recebimento por NF
    // (wms-coletor/NfImportacao.jsx): uma etiqueta "endereco" (QR do
    // pallet + produto + qtd/depósito + endereço) e, se o produto for
    // serializado, uma etiqueta "termica" por máquina com o número de
    // série que o backend gerou (a mesma que vai bipada na separação
    // depois) - em vez do card simples que essa tela usava antes.
    function montarEtiquetasPallet(r, produto, quantidade, deposito) {
        const etiquetaEndereco = {
            tipo: 'endereco',
            sku: produto.sku,
            descricao: produto.descricao,
            quantidade,
            deposito,
            etiquetaCodigo: r.etiquetaCodigo,
            enderecoSugerido: r.enderecoSugerido,
        };
        if (!produto.serializado) return [etiquetaEndereco];
        const etiquetasSerie = (r.numerosSerieGerados || []).map((serie) => ({
            tipo: 'default',
            sku: produto.sku,
            descricao: produto.descricao,
            codigoBarras: produto.codigo_barras,
            numeroSerie: serie,
            enderecoSugerido: r.enderecoSugerido,
        }));
        return [etiquetaEndereco, ...etiquetasSerie];
    }

    const todasRuas = [...new Set(enderecosMapa.map((e) => e.rua))].sort();
    const enderecosDaRuaLote = enderecosMapa.filter((e) => e.rua === ruaLote);
    const todosPrediosLote = [...new Set(enderecosDaRuaLote.map((e) => e.predio))].sort();
    // Andar 1 nunca recebe pallet (reservado pra picking/estoque
    // flutuante - mesma regra do enderecosLivres acima e do backend
    // em criarPalletRecebimento), então nem aparece como opção pra
    // montar o intervalo.
    const todosAndaresLote = [...new Set(enderecosDaRuaLote.map((e) => e.andar))]
        .filter((a) => Number(a) !== 1)
        .sort((a, b) => a - b);

    // Lança uma entrada em CADA endereço LIVRE dentro de um bloco
    // retangular de prédio x andar (ex.: "do R5-A-A2 até R5-F-A5") -
    // um POST /recebimento/iniciar por endereço, com o próprio
    // enderecoId fixado (backend recusa se ele deixou de estar livre
    // nesse meio-tempo), gerando os números de série automaticamente
    // igual à entrada única. Endereços do intervalo que já estão
    // ocupados ou bloqueados são pulados, não travam o lote inteiro.
    async function lancarEntradaIntervalo() {
        const produto = produtos.find((p) => p.id === produtoIdLote);
        if (!produto) return;

        if (!prediosDeLote || !prediosAteLote || !andarDeLote || !andarAteLote) {
            setMensagemLote('Selecione o prédio e o andar iniciais e finais.');
            setEtiquetasLote(null);
            return;
        }
        const [predioMin, predioMax] = [prediosDeLote, prediosAteLote].sort();
        const andarMin = Math.min(Number(andarDeLote), Number(andarAteLote));
        const andarMax = Math.max(Number(andarDeLote), Number(andarAteLote));

        const enderecosNoIntervalo = enderecosDaRuaLote.filter(
            (e) => e.predio >= predioMin && e.predio <= predioMax && Number(e.andar) >= andarMin && Number(e.andar) <= andarMax
        );
        const livresNoIntervalo = enderecosNoIntervalo
            .filter((e) => e.status === 'livre')
            .sort((a, b) => a.codigo.localeCompare(b.codigo));

        if (livresNoIntervalo.length === 0) {
            setMensagemLote('Nenhum endereço livre nesse intervalo.');
            setEtiquetasLote(null);
            return;
        }

        setLancandoLote(true);
        setMensagemLote(null);
        setEtiquetasLote(null);

        const etiquetas = [];
        let sucesso = 0;
        let falhas = 0;
        // Sequencial (não Promise.all) - cada lançamento já é uma
        // transação própria no backend; rodar em paralelo só criaria
        // disputa desnecessária pelas mesmas linhas de endereco no
        // banco sem ganhar velocidade real.
        for (const endereco of livresNoIntervalo) {
            try {
                const resposta = await api.post('/recebimento/iniciar', {
                    sku: produto.sku,
                    quantidade: Number(quantidadeLote),
                    deposito: depositoLote,
                    enderecoId: endereco.id,
                });
                etiquetas.push(...montarEtiquetasPallet(resposta, produto, quantidadeLote, depositoLote));
                sucesso += 1;
            } catch (e) {
                falhas += 1;
            }
        }

        const ignorados = enderecosNoIntervalo.length - livresNoIntervalo.length;
        const partes = [`${sucesso} pallet(s) lançado(s).`];
        if (ignorados > 0) partes.push(`${ignorados} endereço(s) do intervalo já estavam ocupados/bloqueados e foram ignorados.`);
        if (falhas > 0) partes.push(`${falhas} falharam ao lançar.`);
        setMensagemLote(partes.join(' '));
        setEtiquetasLote(etiquetas.length > 0 ? etiquetas : null);
        setLancandoLote(false);
        recarregarEnderecos();
    }

    async function lancarEntradaVertical() {
        const produto = produtos.find((p) => p.id === entradaVertical.produtoId);
        if (!produto) return;

        const quantidade = entradaVertical.quantidade;
        const deposito = entradaVertical.deposito;

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
                    quantidade: Number(quantidade),
                    deposito,
                    numeroPalletes: numero,
                });
                setMensagemVertical(
                    resposta.erroParcial
                        ? `Gerado ${resposta.total} de ${resposta.solicitado} pallet(s). Parou por: ${resposta.erroParcial}`
                        : `${resposta.total} pallet(s) lançado(s).`
                );
                setEtiquetasGeradas(
                    resposta.gerados.flatMap((r) => montarEtiquetasPallet(r, produto, quantidade, deposito))
                );
            } else {
                const resposta = await api.post('/recebimento/iniciar', {
                    sku: produto.sku,
                    quantidade: Number(quantidade),
                    deposito,
                    enderecoId: entradaVertical.enderecoId || undefined,
                });
                setMensagemVertical(`Lançado em ${resposta.enderecoSugerido}.`);
                setEtiquetasGeradas(montarEtiquetasPallet(resposta, produto, quantidade, deposito));
            }

            setEntradaVertical((atual) => ({ ...atual, quantidade: '', numeroPalletes: '1', enderecoId: '' }));
            setBuscaEndereco('');
            recarregarEnderecos();
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
                    {etiquetasGeradas && <EtiquetasTermicas10x5 etiquetas={etiquetasGeradas} />}
                </div>

                <div className="card">
                    <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Entrada em lote por intervalo de endereço</p>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
                        Lança uma entrada em cada endereço livre dentro de um bloco de prédio × andar (ex.: do endereço R5-A-A2 até R5-F-A5) - os números de série de cada pallet são gerados automaticamente, igual na entrada normal. Endereços já ocupados ou bloqueados no intervalo são ignorados.
                    </p>

                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Produto</label>
                    <input
                        type="text"
                        placeholder="Buscar por código ou descrição"
                        value={buscaProdutoLote}
                        onChange={(e) => aoBuscarProdutoLote(e.target.value)}
                        style={{ width: '100%', margin: '4px 0 6px' }}
                    />
                    <select
                        value={produtoIdLote}
                        onChange={(e) => setProdutoIdLote(e.target.value)}
                        style={{ width: '100%', margin: '0 0 10px' }}
                    >
                        {filtrarProdutos(buscaProdutoLote).map((p) => (
                            <option key={p.id} value={p.id}>{p.sku} · {p.descricao}</option>
                        ))}
                    </select>

                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Depósito</label>
                    <select
                        value={depositoLote}
                        onChange={(e) => setDepositoLote(e.target.value)}
                        style={{ width: '100%', margin: '4px 0 10px' }}
                    >
                        {DEPOSITOS.map((d) => (
                            <option key={d} value={d}>{d}</option>
                        ))}
                    </select>

                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Quantidade (por pallet)</label>
                    <input
                        type="number"
                        value={quantidadeLote}
                        onChange={(e) => setQuantidadeLote(e.target.value)}
                        style={{ width: '100%', margin: '4px 0 12px' }}
                    />

                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Rua</label>
                    <select
                        value={ruaLote}
                        onChange={(e) => setRuaLote(e.target.value)}
                        style={{ width: '100%', margin: '4px 0 10px' }}
                    >
                        {todasRuas.map((r) => (
                            <option key={r} value={r}>{r}</option>
                        ))}
                    </select>

                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                        <div>
                            <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Prédio de</label>
                            <select value={prediosDeLote} onChange={(e) => setPrediosDeLote(e.target.value)} style={{ display: 'block', width: 90 }}>
                                <option value="">...</option>
                                {todosPrediosLote.map((p) => (
                                    <option key={p} value={p}>{p}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>até</label>
                            <select value={prediosAteLote} onChange={(e) => setPrediosAteLote(e.target.value)} style={{ display: 'block', width: 90 }}>
                                <option value="">...</option>
                                {todosPrediosLote.map((p) => (
                                    <option key={p} value={p}>{p}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Andar de</label>
                            <select value={andarDeLote} onChange={(e) => setAndarDeLote(e.target.value)} style={{ display: 'block', width: 90 }}>
                                <option value="">...</option>
                                {todosAndaresLote.map((a) => (
                                    <option key={a} value={a}>{a}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>até</label>
                            <select value={andarAteLote} onChange={(e) => setAndarAteLote(e.target.value)} style={{ display: 'block', width: 90 }}>
                                <option value="">...</option>
                                {todosAndaresLote.map((a) => (
                                    <option key={a} value={a}>{a}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <button
                        className="primary"
                        style={{ width: '100%' }}
                        disabled={lancandoLote || !produtoIdLote || !quantidadeLote || !prediosDeLote || !prediosAteLote || !andarDeLote || !andarAteLote}
                        onClick={lancarEntradaIntervalo}
                    >
                        {lancandoLote ? 'Lançando...' : 'Lançar entradas do intervalo'}
                    </button>

                    {mensagemLote && <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>{mensagemLote}</p>}
                    {etiquetasLote && <EtiquetasTermicas10x5 etiquetas={etiquetasLote} />}
                </div>
            </div>
            </div>
        </div>
    );
}
