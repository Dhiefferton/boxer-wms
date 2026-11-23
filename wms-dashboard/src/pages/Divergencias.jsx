import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext.jsx';
import { useDefinirTitulo } from '../contexts/TituloPaginaContext.jsx';
import AcompanhamentoInventario from '../components/AcompanhamentoInventario.jsx';

export default function Divergencias() {
    useDefinirTitulo('Inventário');
    const { pode, colaborador } = useAuth();
    const somenteLeitura = !pode('inventario.gerenciar');
    const [lista, setLista] = useState([]);
    const [selecionada, setSelecionada] = useState(null);
    const [valorAprovado, setValorAprovado] = useState('');
    const [observacao, setObservacao] = useState('');
    const [mensagem, setMensagem] = useState(null);
    const [quantidadeCiclico, setQuantidadeCiclico] = useState(10);
    const [gerando, setGerando] = useState(null);

    function carregar() {
        api.get('/inventario/divergencias').then(setLista);
    }

    useEffect(carregar, []);

    async function gerarCiclico() {
        setGerando('ciclico');
        setMensagem(null);
        try {
            const resposta = await api.post('/inventario/gerar-ciclico', { quantidade: Number(quantidadeCiclico) });
            setMensagem(`${resposta.criadas} tarefa(s) de contagem cíclica gerada(s).`);
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        } finally {
            setGerando(null);
        }
    }

    async function gerarGeral() {
        if (!confirm('Gerar contagem geral cria uma tarefa pra TODAS as posições ocupadas do vertical. Confirma?')) {
            return;
        }
        setGerando('geral');
        setMensagem(null);
        try {
            const resposta = await api.post('/inventario/gerar-geral');
            setMensagem(`${resposta.criadas} tarefa(s) de inventário geral gerada(s).`);
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        } finally {
            setGerando(null);
        }
    }

    function selecionar(item) {
        setSelecionada(item);
        setValorAprovado('');
        setObservacao('');
        setMensagem(null);
    }

    async function aprovar() {
        try {
            await api.post(`/inventario/divergencias/${selecionada.contagem_id}/aprovar`, {
                quantidadeAprovada: Number(valorAprovado),
                supervisor: colaborador?.nome || 'Supervisor',
                observacao,
            });
            setMensagem('Ajuste aprovado e aplicado.');
            setSelecionada(null);
            carregar();
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        }
    }

    return (
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <AcompanhamentoInventario />

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, alignItems: 'start' }}>
                {!somenteLeitura && (
                    <div className="card">
                        <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Gerar contagem</p>
                        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
                            Gere as posições a contar; o andamento aparece no acompanhamento acima, em tempo real.
                        </p>
                        <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '0 0 4px' }}>Contagem cíclica (posições há mais tempo sem contar)</p>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                            <input
                                type="number"
                                min="1"
                                value={quantidadeCiclico}
                                onChange={(e) => setQuantidadeCiclico(e.target.value)}
                                style={{ width: 90 }}
                                title="Quantas posições entram nesta rodada"
                            />
                            <button disabled={!!gerando} onClick={gerarCiclico} style={{ flex: 1 }}>
                                {gerando === 'ciclico' ? 'Gerando...' : 'Gerar contagem cíclica'}
                            </button>
                        </div>
                        <button disabled={!!gerando} onClick={gerarGeral} style={{ width: '100%' }}>
                            {gerando === 'geral' ? 'Gerando...' : 'Gerar inventário geral (todas as posições)'}
                        </button>
                        {mensagem && <p style={{ fontSize: 13, margin: '12px 0 0' }}>{mensagem}</p>}
                    </div>
                )}

                <div className="card">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                        <p style={{ fontSize: 15, fontWeight: 700, margin: 0, flex: 1 }}>Divergências pendentes de aprovação</p>
                        {lista.length > 0 && <span className="badge danger">{lista.length}</span>}
                    </div>

                    {lista.length === 0 && <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Nenhuma divergência pendente.</p>}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {lista.map((item) => (
                            <div
                                key={item.contagem_id}
                                onClick={() => selecionar(item)}
                                style={{
                                    cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                                    padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)',
                                    background: selecionada?.contagem_id === item.contagem_id ? 'var(--accent-bg)' : undefined,
                                }}
                            >
                                <div style={{ minWidth: 0 }}>
                                    <p style={{ fontWeight: 600, margin: 0, fontSize: 13 }}>{item.endereco} · {item.sku}</p>
                                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>{item.descricao}</p>
                                </div>
                                <span className="badge danger">Aprovar</span>
                            </div>
                        ))}
                    </div>

                    {selecionada && (
                        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                            <p style={{ fontWeight: 600, margin: '0 0 10px' }}>{selecionada.endereco} · {selecionada.sku}</p>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 12 }}>
                                {[['Sistema esperava', selecionada.saldo_esperado], ['1ª contagem', selecionada.primeira_contagem], ['2ª contagem', selecionada.segunda_contagem]].map(([r, v]) => (
                                    <div key={r} style={{ textAlign: 'center', padding: 8, borderRadius: 8, background: 'var(--neutro-bg)' }}>
                                        <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: 0 }}>{r}</p>
                                        <p style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{v}</p>
                                    </div>
                                ))}
                            </div>
                            {!somenteLeitura && (
                                <>
                                    <input
                                        type="number"
                                        placeholder="Valor final aprovado"
                                        value={valorAprovado}
                                        onChange={(e) => setValorAprovado(e.target.value)}
                                        style={{ width: '100%', marginBottom: 8 }}
                                    />
                                    <textarea
                                        placeholder="Observação (opcional)"
                                        value={observacao}
                                        onChange={(e) => setObservacao(e.target.value)}
                                        style={{ width: '100%', minHeight: 60, marginBottom: 8 }}
                                    />
                                    <button className="primary" style={{ width: '100%' }} disabled={!valorAprovado} onClick={aprovar}>
                                        Aprovar ajuste
                                    </button>
                                </>
                            )}
                        </div>
                    )}
                    {somenteLeitura && mensagem && <p style={{ fontSize: 13, margin: '12px 0 0' }}>{mensagem}</p>}
                </div>
            </div>
        </div>
    );
}
