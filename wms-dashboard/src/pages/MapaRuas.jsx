import { useEffect, useState } from 'react';
import { api } from '../api';

function corPorQuantidade(qtd) {
    if (!qtd) return '#f1f2f6';
    if (qtd < 40) return '#dce6fb';
    if (qtd < 120) return '#85b7eb';
    return '#185fa5';
}

export default function MapaRuas() {
    const [enderecos, setEnderecos] = useState([]);
    const [kpis, setKpis] = useState(null);
    const [selecionado, setSelecionado] = useState(null);
    const [carregando, setCarregando] = useState(true);
    const [erro, setErro] = useState(null);

    useEffect(() => {
        Promise.all([api.get('/enderecos/mapa'), api.get('/enderecos/kpis')])
            .then(([mapa, kpisResp]) => {
                setEnderecos(mapa);
                setKpis(kpisResp);
            })
            .catch((e) => setErro(e.message))
            .finally(() => setCarregando(false));
    }, []);

    if (carregando) return <p>Carregando mapa de ruas...</p>;
    if (erro) return <p style={{ color: 'var(--danger-text)' }}>Erro: {erro}. Confira se a API está rodando.</p>;

    const predios = [...new Set(enderecos.map((e) => e.predio))].sort();
    const andares = [...new Set(enderecos.map((e) => e.andar))].sort((a, b) => b - a);

    return (
        <div>
            <h2 style={{ fontSize: 20, marginBottom: '1rem' }}>Mapa de ruas — armazenagem vertical</h2>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px,1fr))', gap: 12, marginBottom: '1.5rem' }}>
                <div className="card">
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Posições livres</p>
                    <p style={{ fontSize: 24, fontWeight: 600 }}>{kpis.posicoes_livres}</p>
                </div>
                <div className="card">
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Posições ocupadas</p>
                    <p style={{ fontSize: 24, fontWeight: 600 }}>{kpis.posicoes_ocupadas}</p>
                </div>
                <div className="card">
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Produtos distintos</p>
                    <p style={{ fontSize: 24, fontWeight: 600 }}>{kpis.produtos_distintos}</p>
                </div>
                <div className="card">
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Soma de itens</p>
                    <p style={{ fontSize: 24, fontWeight: 600 }}>{kpis.soma_produtos}</p>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
                <div className="card" style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                            <tr>
                                <th style={{ textAlign: 'left', padding: 6 }}>Andar</th>
                                {predios.map((p) => (
                                    <th key={p} style={{ padding: 6 }}>{p}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {andares.map((andar) => (
                                <tr key={andar}>
                                    <td style={{ padding: 6, fontWeight: 500 }}>{andar}</td>
                                    {predios.map((predio) => {
                                        const e = enderecos.find((x) => x.predio === predio && x.andar === andar);
                                        return (
                                            <td
                                                key={predio}
                                                onClick={() => e && setSelecionado(e)}
                                                style={{
                                                    padding: 6,
                                                    textAlign: 'center',
                                                    background: corPorQuantidade(e?.quantidade),
                                                    borderRadius: 4,
                                                    cursor: 'pointer',
                                                }}
                                            >
                                                {e?.quantidade || ''}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="card">
                    <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Detalhe da posição</p>
                    {selecionado ? (
                        <>
                            <p style={{ fontSize: 16, fontWeight: 600 }}>{selecionado.codigo}</p>
                            {selecionado.sku ? (
                                <>
                                    <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                                        {selecionado.sku} · {selecionado.descricao}
                                    </p>
                                    <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                                        Quantidade: {selecionado.quantidade}
                                    </p>
                                    <span className={`badge ${selecionado.etiqueta_status === 'com_etiqueta' ? 'success' : 'warning'}`}>
                                        {selecionado.etiqueta_status === 'com_etiqueta' ? 'Com etiqueta' : 'Sem etiqueta'}
                                    </span>
                                </>
                            ) : (
                                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Posição livre</p>
                            )}
                        </>
                    ) : (
                        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Clique numa posição do mapa</p>
                    )}
                </div>
            </div>
        </div>
    );
}
