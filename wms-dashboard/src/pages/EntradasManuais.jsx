import { useEffect, useState } from 'react';
import { api } from '../api';

const DEPOSITOS = ['Maquinas', 'Avarias', 'Verde', 'Vermelho', 'Amarelo'];

export default function EntradasManuais() {
    const [produtos, setProdutos] = useState([]);
    const [areas, setAreas] = useState([]);

    // --- Entrada no vertical ---
    const [buscaVertical, setBuscaVertical] = useState('');
    const [entradaVertical, setEntradaVertical] = useState({ produtoId: '', deposito: DEPOSITOS[0], quantidade: '' });
    const [lancandoVertical, setLancandoVertical] = useState(false);
    const [mensagemVertical, setMensagemVertical] = useState(null);

    // --- Entrada no flutuante ---
    const [buscaFlutuante, setBuscaFlutuante] = useState('');
    const [entradaFlutuante, setEntradaFlutuante] = useState({ produtoId: '', areaId: '', quantidade: '' });
    const [lancandoFlutuante, setLancandoFlutuante] = useState(false);
    const [mensagemFlutuante, setMensagemFlutuante] = useState(null);

    useEffect(() => {
        api.get('/produtos').then((lista) => {
            setProdutos(lista);
            setEntradaVertical((atual) => ({ ...atual, produtoId: atual.produtoId || lista[0]?.id || '' }));
            setEntradaFlutuante((atual) => ({ ...atual, produtoId: atual.produtoId || lista[0]?.id || '' }));
        });
        api.get('/areas-flutuante').then((lista) => {
            setAreas(lista);
            setEntradaFlutuante((atual) => ({ ...atual, areaId: atual.areaId || lista[0]?.id || '' }));
        });
    }, []);

    function filtrarProdutos(busca) {
        if (!busca) return produtos;
        const termo = busca.toLowerCase();
        return produtos.filter(
            (p) => p.sku.toLowerCase().includes(termo) || p.descricao.toLowerCase().includes(termo)
        );
    }

    async function lancarEntradaVertical() {
        const produto = produtos.find((p) => p.id === entradaVertical.produtoId);
        if (!produto) return;

        setLancandoVertical(true);
        setMensagemVertical(null);
        try {
            const resposta = await api.post('/recebimento/iniciar', {
                sku: produto.sku,
                quantidade: Number(entradaVertical.quantidade),
                deposito: entradaVertical.deposito,
            });
            setMensagemVertical(`Lançado em ${resposta.enderecoSugerido}.`);
            setEntradaVertical((atual) => ({ ...atual, quantidade: '' }));
        } catch (e) {
            setMensagemVertical(`Erro: ${e.message}`);
        } finally {
            setLancandoVertical(false);
        }
    }

    async function lancarEntradaFlutuante() {
        setLancandoFlutuante(true);
        setMensagemFlutuante(null);
        try {
            await api.post('/areas-flutuante/estoque', {
                produtoId: entradaFlutuante.produtoId,
                areaId: entradaFlutuante.areaId,
                quantidade: Number(entradaFlutuante.quantidade),
            });
            setMensagemFlutuante('Entrada lançada com sucesso.');
            setEntradaFlutuante((atual) => ({ ...atual, quantidade: '' }));
        } catch (e) {
            setMensagemFlutuante(`Erro: ${e.message}`);
        } finally {
            setLancandoFlutuante(false);
        }
    }

    return (
        <div>
            <h2 style={{ fontSize: 20, marginBottom: '1rem' }}>Entradas manuais</h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
                Lançamentos manuais de estoque, direto pelo dashboard - sem passar pelo fluxo normal
                de recebimento ou reposição no coletor. Use com cuidado.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
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
                        onChange={(e) => setBuscaVertical(e.target.value)}
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

                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Quantidade</label>
                    <input
                        type="number"
                        value={entradaVertical.quantidade}
                        onChange={(e) => setEntradaVertical({ ...entradaVertical, quantidade: e.target.value })}
                        style={{ width: '100%', margin: '4px 0 12px' }}
                    />

                    <button
                        className="primary"
                        style={{ width: '100%' }}
                        disabled={lancandoVertical || !entradaVertical.produtoId || !entradaVertical.quantidade}
                        onClick={lancarEntradaVertical}
                    >
                        {lancandoVertical ? 'Lançando...' : 'Lançar entrada'}
                    </button>

                    {mensagemVertical && <p style={{ fontSize: 12, marginTop: 8 }}>{mensagemVertical}</p>}
                </div>

                <div className="card">
                    <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Flutuante (picking)</p>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
                        Soma direto no saldo do flutuante, sem passar por reposição do vertical.
                    </p>

                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Produto</label>
                    <input
                        type="text"
                        placeholder="Buscar por código ou descrição"
                        value={buscaFlutuante}
                        onChange={(e) => setBuscaFlutuante(e.target.value)}
                        style={{ width: '100%', margin: '4px 0 6px' }}
                    />
                    <select
                        value={entradaFlutuante.produtoId}
                        onChange={(e) => setEntradaFlutuante({ ...entradaFlutuante, produtoId: e.target.value })}
                        style={{ width: '100%', margin: '0 0 10px' }}
                    >
                        {filtrarProdutos(buscaFlutuante).map((p) => (
                            <option key={p.id} value={p.id}>{p.sku} · {p.descricao}</option>
                        ))}
                    </select>

                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Área</label>
                    <select
                        value={entradaFlutuante.areaId}
                        onChange={(e) => setEntradaFlutuante({ ...entradaFlutuante, areaId: e.target.value })}
                        style={{ width: '100%', margin: '4px 0 10px' }}
                    >
                        {areas.map((a) => (
                            <option key={a.id} value={a.id}>{a.nome}</option>
                        ))}
                    </select>

                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Quantidade</label>
                    <input
                        type="number"
                        value={entradaFlutuante.quantidade}
                        onChange={(e) => setEntradaFlutuante({ ...entradaFlutuante, quantidade: e.target.value })}
                        style={{ width: '100%', margin: '4px 0 12px' }}
                    />

                    <button
                        className="primary"
                        style={{ width: '100%' }}
                        disabled={
                            lancandoFlutuante ||
                            !entradaFlutuante.produtoId ||
                            !entradaFlutuante.areaId ||
                            !entradaFlutuante.quantidade
                        }
                        onClick={lancarEntradaFlutuante}
                    >
                        {lancandoFlutuante ? 'Lançando...' : 'Lançar entrada'}
                    </button>

                    {mensagemFlutuante && <p style={{ fontSize: 12, marginTop: 8 }}>{mensagemFlutuante}</p>}
                </div>
            </div>
        </div>
    );
}
