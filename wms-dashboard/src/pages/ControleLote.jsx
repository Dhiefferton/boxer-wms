import { useEffect, useRef, useState } from 'react';
import { Search, RotateCw } from 'lucide-react';
import { api } from '../api';
import { useDefinirTitulo } from '../contexts/TituloPaginaContext.jsx';

// Relatório (estilo planilha) de Lote/Romaneio por recebimento -
// colunas no mesmo formato da planilha de referência usada pelo time
// de compras: Data Chegada | N° NF | Código | Modelo | Lote |
// Romaneio | Quantidade.
//
// Data Chegada aqui é sempre o momento em que o colaborador confirmou
// o recebimento no WMS (não a data da nota no ZenERP) - os dados são
// gravados automaticamente nesse instante, essa tela só lê.
export default function ControleLote() {
    useDefinirTitulo('Controle de Lote');

    const [busca, setBusca] = useState('');
    const [lista, setLista] = useState([]);
    const [carregando, setCarregando] = useState(false);
    const [temMais, setTemMais] = useState(false);
    const [erro, setErro] = useState(null);
    const pagina = 50;

    const buscaAtualRef = useRef(0);
    const primeiraCargaRef = useRef(true);

    async function buscar(proximaPagina = false) {
        const idDestaBusca = ++buscaAtualRef.current;
        setCarregando(true);
        setErro(null);
        try {
            const first = proximaPagina ? lista.length : 0;
            const params = new URLSearchParams();
            if (busca.trim()) params.set('texto', busca.trim());
            params.set('first', first);
            params.set('max', pagina);

            const resposta = await api.get(`/controle-lote?${params.toString()}`);

            if (idDestaBusca !== buscaAtualRef.current) return;

            setLista(proximaPagina ? [...lista, ...resposta] : resposta);
            setTemMais(resposta.length === pagina);
        } catch (e) {
            if (idDestaBusca !== buscaAtualRef.current) return;
            if (!proximaPagina) setLista([]);
            setErro(e.message || 'Falha ao consultar o controle de lote');
        } finally {
            if (idDestaBusca === buscaAtualRef.current) setCarregando(false);
        }
    }

    useEffect(() => {
        if (primeiraCargaRef.current) {
            primeiraCargaRef.current = false;
            buscar();
            return;
        }
        const temporizador = setTimeout(() => buscar(false), 400);
        return () => clearTimeout(temporizador);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [busca]);

    return (
        <div>
            <div className="card wms-toolbar" style={{ marginBottom: 16 }}>
                <Search size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <input
                    type="text"
                    className="wms-toolbar-input"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && buscar(false)}
                    placeholder="Buscar por código, modelo, NF, lote ou romaneio"
                />
                <button type="button" className="wms-toolbar-btn primary" title="Buscar" onClick={() => buscar(false)} disabled={carregando}>
                    <RotateCw size={16} />
                </button>
            </div>

            {erro && (
                <p style={{ fontSize: 13, color: 'var(--danger-text)', marginBottom: 16 }}>{erro}</p>
            )}

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-page)' }}>
                                <th style={{ textAlign: 'left', padding: 10, fontSize: 12, whiteSpace: 'nowrap' }}>Data Chegada</th>
                                <th style={{ textAlign: 'left', padding: 10, fontSize: 12, whiteSpace: 'nowrap' }}>N° NF</th>
                                <th style={{ textAlign: 'left', padding: 10, fontSize: 12, whiteSpace: 'nowrap' }}>Código</th>
                                <th style={{ textAlign: 'left', padding: 10, fontSize: 12 }}>Modelo</th>
                                <th style={{ textAlign: 'left', padding: 10, fontSize: 12, whiteSpace: 'nowrap' }}>Lote</th>
                                <th style={{ textAlign: 'left', padding: 10, fontSize: 12, whiteSpace: 'nowrap' }}>Romaneio</th>
                                <th style={{ textAlign: 'right', padding: 10, fontSize: 12, whiteSpace: 'nowrap' }}>Quantidade</th>
                            </tr>
                        </thead>
                        <tbody>
                            {lista.map((linha) => (
                                <tr key={linha.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                    <td style={{ padding: 10, fontSize: 13, whiteSpace: 'nowrap' }}>
                                        {new Date(linha.dataChegada).toLocaleDateString('pt-BR')}
                                    </td>
                                    <td style={{ padding: 10, fontSize: 13, whiteSpace: 'nowrap' }}>{linha.numeroNf || '—'}</td>
                                    <td style={{ padding: 10, fontSize: 13, whiteSpace: 'nowrap' }}>{linha.codigo}</td>
                                    <td style={{ padding: 10, fontSize: 13 }}>{linha.modelo || '—'}</td>
                                    <td style={{ padding: 10, fontSize: 13, whiteSpace: 'nowrap' }}>{linha.lote}</td>
                                    <td style={{ padding: 10, fontSize: 13, whiteSpace: 'nowrap' }}>{linha.romaneio}</td>
                                    <td style={{ padding: 10, fontSize: 13, textAlign: 'right' }}>{linha.quantidade}</td>
                                </tr>
                            ))}
                            {lista.length === 0 && !carregando && (
                                <tr>
                                    <td colSpan={7} style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)' }}>
                                        Nenhum lote registrado ainda com esse filtro.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {temMais && (
                <button style={{ marginTop: 12 }} onClick={() => buscar(true)} disabled={carregando}>
                    {carregando ? 'Carregando...' : 'Carregar mais'}
                </button>
            )}
        </div>
    );
}
