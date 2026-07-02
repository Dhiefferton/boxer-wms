import { useEffect, useState } from 'react';
import { api } from '../api';

export default function AreasFlutuante() {
    const [areas, setAreas] = useState([]);
    const [nome, setNome] = useState('');
    const [mensagem, setMensagem] = useState(null);

    function carregar() {
        api.get('/areas-flutuante').then(setAreas);
    }

    useEffect(carregar, []);

    async function adicionar() {
        try {
            await api.post('/areas-flutuante', { nome });
            setNome('');
            carregar();
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        }
    }

    async function excluir(id) {
        try {
            await api.delete(`/areas-flutuante/${id}`);
            carregar();
        } catch (e) {
            setMensagem(`Erro: ${e.message}`);
        }
    }

    return (
        <div>
            <h2 style={{ fontSize: 20, marginBottom: '1rem' }}>Áreas do estoque flutuante</h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                Zonas físicas fixas (corredores, prateleiras) usadas na separação e na reposição —
                sem endereçamento granular, como definimos no desenho do banco.
            </p>

            <div style={{ display: 'flex', gap: 8, marginBottom: '1.5rem', maxWidth: 420 }}>
                <input
                    type="text"
                    placeholder="Nome da área (ex: Corredor B)"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    style={{ flex: 1 }}
                />
                <button className="primary" disabled={!nome} onClick={adicionar}>
                    Adicionar
                </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 420 }}>
                {areas.map((a) => (
                    <div key={a.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>{a.nome}</span>
                        <button onClick={() => excluir(a.id)}>Excluir</button>
                    </div>
                ))}
            </div>

            {mensagem && <p style={{ fontSize: 13, marginTop: 12 }}>{mensagem}</p>}
        </div>
    );
}
