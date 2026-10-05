import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import BipagemInput from '../components/BipagemInput.jsx';
import EtiquetasTermicas10x5 from '../components/EtiquetaTermica10x5.jsx';

// Estoque Pulmão -> Vertical (motor MANUAL desde 05/10/2026, a pedido do
// Dhiefferton). Acabou a fila automática: o operador pega QUALQUER pallet
// que esteja no Estoque Pulmão ou no Pulmão Teste - bipando a etiqueta
// (leitor ou câmera) ou escolhendo na lista - e manda pro vertical.
//
// A posição no vertical é escolhida sozinha pelo sistema, na hora de
// confirmar (mesma regra do recebimento normal), e o pallet sobe com a
// MESMA etiqueta que já tem (nada de reimprimir/recolar). Esta tela só
// precisa mostrar, bem grande, ONDE guardar.
//
// Único caso com etiqueta nova: o pallet não cabe inteiro na posição achada
// (ver transferirPalletPulmaoParaVertical, wms-api/lib/pulmao.js) - aí sobe
// só o que cabe, e a tela mostra a etiqueta nova pra imprimir.

function tempoRelativo(dataIso) {
    const min = Math.round((Date.now() - new Date(dataIso).getTime()) / 60000);
    if (min < 60) return `há ${Math.max(min, 1)} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `há ${h}h`;
    return `há ${Math.round(h / 24)}d`;
}

export default function Pulmao() {
    const navigate = useNavigate();
    const [carregando, setCarregando] = useState(true);
    const [pallets, setPallets] = useState([]);
    const [erro, setErro] = useState(null);
    const [filtro, setFiltro] = useState('todos'); // 'todos' | 'pulmao' | 'teste'
    const [busca, setBusca] = useState('');
    const [procurando, setProcurando] = useState(false);
    const [selecionado, setSelecionado] = useState(null);
    const [transferindo, setTransferindo] = useState(false);
    const [resultado, setResultado] = useState(null);

    function carregarLista() {
        return api
            .get('/pulmao/pallets')
            .then(setPallets)
            .catch((e) => setErro(e.message))
            .finally(() => setCarregando(false));
    }

    useEffect(() => {
        carregarLista();
    }, []);

    const totalTeste = useMemo(() => pallets.filter((p) => p.teste_status === 'nao_testado').length, [pallets]);

    const listaFiltrada = useMemo(() => {
        const termo = busca.trim().toUpperCase();
        return pallets.filter((p) => {
            if (filtro === 'pulmao' && p.teste_status === 'nao_testado') return false;
            if (filtro === 'teste' && p.teste_status !== 'nao_testado') return false;
            if (!termo) return true;
            return (
                (p.sku || '').toUpperCase().includes(termo) ||
                (p.descricao || '').toUpperCase().includes(termo) ||
                (p.etiqueta_codigo || '').toUpperCase().includes(termo)
            );
        });
    }, [pallets, filtro, busca]);

    async function biparEtiqueta(codigoBruto) {
        const codigo = codigoBruto.trim().replace(/^#/, '');
        setProcurando(true);
        setErro(null);
        try {
            const pallet = await api.get(`/pulmao/pallets/etiqueta/${encodeURIComponent(codigo)}`);
            setSelecionado(pallet);
        } catch (e) {
            setErro(e.message);
        } finally {
            setProcurando(false);
        }
    }

    async function transferir() {
        setTransferindo(true);
        setErro(null);
        try {
            const resposta = await api.post(`/pulmao/pallets/${selecionado.id}/transferir`);
            setResultado(resposta);
            setSelecionado(null);
            carregarLista();
        } catch (e) {
            setErro(e.message);
        } finally {
            setTransferindo(false);
        }
    }

    function proximo() {
        setResultado(null);
        setSelecionado(null);
        setErro(null);
        setBusca('');
    }

    if (carregando) {
        return (
            <div className="tela">
                <p style={{ color: 'var(--text-muted)' }}>Carregando...</p>
            </div>
        );
    }

    const cabecalho = (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button onClick={() => navigate('/')}>←</button>
            <span className="badge warning">Estoque Pulmão → Vertical</span>
        </div>
    );

    // ---------------- Resultado: onde guardar ----------------
    if (resultado) {
        return (
            <div className="tela">
                {cabecalho}

                <div className="card" style={{ background: 'var(--success-bg)', textAlign: 'center', padding: '20px 12px' }}>
                    <p style={{ fontSize: 13, color: 'var(--success-text)', margin: 0 }}>GUARDAR O PALLET EM</p>
                    <p
                        style={{
                            fontSize: 44,
                            fontWeight: 800,
                            lineHeight: 1.1,
                            margin: '8px 0',
                            color: 'var(--success-text)',
                            fontFamily: 'var(--font-display)',
                            wordBreak: 'break-word',
                        }}
                    >
                        {resultado.enderecoDestino}
                    </p>
                    <p style={{ fontSize: 14, color: 'var(--success-text)', margin: 0 }}>
                        {resultado.produtoSku} · {resultado.quantidadeMovida} un.
                    </p>
                </div>

                {resultado.mesmaEtiqueta ? (
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                        Leve o pallet com a etiqueta que ele já tem ({resultado.etiquetaCodigo}) até esse endereço. Não precisa
                        imprimir etiqueta nova.
                    </p>
                ) : (
                    <>
                        <div className="card" style={{ background: 'var(--warning-bg)' }}>
                            <p style={{ fontSize: 13, color: 'var(--warning-text)', margin: 0 }}>
                                O pallet não coube inteiro nessa posição. Subiram {resultado.quantidadeMovida} un. num pallet novo -
                                cole a etiqueta nova abaixo nele. As outras {resultado.quantidadeRestanteNoPulmao} un. continuam no
                                Pulmão com a etiqueta antiga.
                            </p>
                        </div>
                        <EtiquetasTermicas10x5
                            etiquetas={[
                                {
                                    tipo: 'endereco',
                                    sku: resultado.produtoSku,
                                    descricao: resultado.descricao,
                                    quantidade: resultado.quantidadeMovida,
                                    etiquetaCodigo: resultado.etiquetaNova,
                                    enderecoSugerido: resultado.enderecoDestino,
                                },
                            ]}
                        />
                    </>
                )}

                <button className="primary" style={{ width: '100%', marginTop: 8 }} onClick={proximo}>
                    Próximo pallet
                </button>
            </div>
        );
    }

    // ---------------- Pallet escolhido: confirmar ----------------
    if (selecionado) {
        const naoTestado = selecionado.teste_status === 'nao_testado';
        return (
            <div className="tela">
                {cabecalho}

                <div className="card">
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
                        {naoTestado ? 'Retirar do Pulmão Teste' : 'Retirar do Estoque Pulmão (chão)'}
                    </p>
                    <p style={{ fontSize: 20, fontWeight: 700, margin: '4px 0' }}>{selecionado.sku}</p>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>{selecionado.descricao}</p>
                    <p style={{ fontSize: 15, fontWeight: 600, margin: '8px 0 0' }}>{selecionado.quantidade} un.</p>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>
                        etiqueta {selecionado.etiqueta_codigo}
                    </p>
                </div>

                {naoTestado && (
                    <div className="card" style={{ background: 'var(--warning-bg)' }}>
                        <p style={{ fontSize: 13, color: 'var(--warning-text)', margin: 0 }}>
                            Esse pallet está no Pulmão Teste e o teste ainda não foi aprovado. Ao transferir, ele passa a valer como
                            testado.
                        </p>
                    </div>
                )}

                <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    O sistema escolhe a posição no vertical ao confirmar e mostra aqui onde guardar. O pallet sobe com a mesma
                    etiqueta.
                </p>

                {erro && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erro}</p>}

                <button className="primary" style={{ width: '100%' }} disabled={transferindo} onClick={transferir}>
                    {transferindo ? 'Transferindo...' : 'Transferir pro vertical'}
                </button>
                <button
                    style={{ width: '100%' }}
                    disabled={transferindo}
                    onClick={() => {
                        setSelecionado(null);
                        setErro(null);
                    }}
                >
                    Voltar
                </button>
            </div>
        );
    }

    // ---------------- Início: bipar ou escolher ----------------
    return (
        <div className="tela">
            {cabecalho}

            <BipagemInput label="Bipar a etiqueta do pallet no Pulmão" onBipar={biparEtiqueta} disabled={procurando} />
            {procurando && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Procurando o pallet...</p>}
            {erro && <p style={{ fontSize: 13, color: 'var(--danger-text)' }}>{erro}</p>}

            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
                Ou escolha na lista ({pallets.length} pallet(s) no chão):
            </p>

            <div style={{ display: 'flex', gap: 6 }}>
                {[
                    { chave: 'todos', label: 'Todos' },
                    { chave: 'pulmao', label: 'Pulmão' },
                    { chave: 'teste', label: `Teste${totalTeste > 0 ? ` (${totalTeste})` : ''}` },
                ].map((item) => (
                    <button
                        key={item.chave}
                        className={filtro === item.chave ? 'primary' : undefined}
                        style={{ flex: 1, fontSize: 13 }}
                        onClick={() => setFiltro(item.chave)}
                    >
                        {item.label}
                    </button>
                ))}
            </div>

            <input
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Filtrar por SKU, descrição ou etiqueta"
            />

            {listaFiltrada.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    {pallets.length === 0 ? 'Nenhum pallet no Pulmão agora.' : 'Nenhum pallet encontrado nesse filtro.'}
                </p>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {listaFiltrada.map((p) => (
                        <button
                            key={p.id}
                            className="card"
                            style={{ textAlign: 'left', width: '100%', cursor: 'pointer' }}
                            onClick={() => {
                                setErro(null);
                                setSelecionado(p);
                            }}
                        >
                            <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                <strong style={{ fontSize: 15 }}>{p.sku}</strong>
                                {p.teste_status === 'nao_testado' && <span className="badge warning">Teste</span>}
                            </span>
                            <span style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', margin: '2px 0 4px' }}>
                                {p.descricao}
                            </span>
                            <span style={{ display: 'block', fontSize: 12 }}>
                                {p.quantidade} un. · {p.etiqueta_codigo} · {tempoRelativo(p.data_entrada)}
                            </span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
