import { useEffect, useState } from 'react';
import { api } from '../api';

export default function Divergencias() {
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
                supervisor: 'Boxer Soldas',
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
        <div>
            <h2 style={{ fontSize: 20, marginBottom: '1rem' }}>Inventário</h2>

            <div className="card" style={{ maxWidth: 480, marginBottom: '1.5rem' }}>
                <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Gerar contagem</p>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
                    Também roda sozinho, automaticamente, uma vez por mês (na 1ª semana). Aqui é só
                    pra disparar na hora, quando quiser.
                </p>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                    <input
                        type="number"
                        value={quantidadeCiclico}
                        onChange={(e) => setQuantidadeCiclico(e.target.value)}
                        style={{ width: 80 }}
                    />
                    <button disabled={!!gerando} onClick={gerarCiclico} style={{ flex: 1 }}>
                        {gerando === 'ciclico' ? 'Gerando...' : 'Gerar contagem cíclica'}
                    </button>
                </div>

                <button disabled={!!gerando} onClick={gerarGeral} style={{ width: '100%' }}>
                    {gerando === 'geral' ? 'Gerando...' : 'Gerar inventário geral (todas as posições)'}
                </button>
            </div>

            <h2 style={{ fontSize: 20, marginBottom: '1rem' }}>Divergências pendentes de aprovação</h2>

            {lista.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Nenhuma divergência pendente.</p>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: '1.5rem' }}>
                {lista.map((item) => (
                    <div
                        key={item.contagem_id}
                        className="card"
                        onClick={() => selecionar(item)}
                        style={{
                            cursor: 'pointer',
                            display: 'flex',
                            justifyContent: 'space-between',
                            background: selecionada?.contagem_id === item.contagem_id ? 'var(--accent-bg)' : undefined,
                        }}
                    >
                        <div>
                            <p style={{ fontWeight: 500 }}>{item.sku} · {item.descricao}</p>
                            <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.endereco}</p>
                        </div>
                        <span className="badge danger">Escalonado</span>
                    </div>
                ))}
            </div>

            {selecionada && (
                <div className="card" style={{ maxWidth: 480 }}>
                    <p style={{ fontWeight: 500, marginBottom: 12 }}>
                        {selecionada.sku} · {selecionada.endereco}
                    </p>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 16 }}>
                        <div className="card" style={{ textAlign: 'center' }}>
                            <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Sistema esperava</p>
                            <p style={{ fontSize: 20, fontWeight: 600 }}>{selecionada.saldo_esperado}</p>
                        </div>
                        <div className="card" style={{ textAlign: 'center' }}>
                            <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>1ª contagem</p>
                            <p style={{ fontSize: 20, fontWeight: 600 }}>{selecionada.primeira_contagem}</p>
                        </div>
                        <div className="card" style={{ textAlign: 'center' }}>
                            <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>2ª contagem</p>
                            <p style={{ fontSize: 20, fontWeight: 600 }}>{selecionada.segunda_contagem}</p>
                        </div>
                    </div>

                    <input
                        type="number"
                        placeholder="Valor final aprovado"
                        value={valorAprovado}
                        onChange={(e) => setValorAprovado(e.target.value)}
                        style={{ width: '100%', marginBottom: 12 }}
                    />
                    <textarea
                        placeholder="Observação (opcional)"
                        value={observacao}
                        onChange={(e) => setObservacao(e.target.value)}
                        style={{ width: '100%', minHeight: 60, marginBottom: 12 }}
                    />

                    <button className="primary" style={{ width: '100%' }} disabled={!valorAprovado} onClick={aprovar}>
                        Aprovar ajuste
                    </button>
                </div>
            )}

            {mensagem && <p style={{ fontSize: 13, marginTop: 12 }}>{mensagem}</p>}
        </div>
    );
}
