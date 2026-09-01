import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';

export default function Login() {
    const { entrar } = useAuth();
    const [email, setEmail] = useState('');
    const [senha, setSenha] = useState('');
    const [erro, setErro] = useState(null);
    const [entrando, setEntrando] = useState(false);

    async function aoEnviar(evento) {
        evento.preventDefault();
        setErro(null);
        setEntrando(true);
        try {
            await entrar(email, senha);
        } catch (e) {
            setErro(e.message);
        } finally {
            setEntrando(false);
        }
    }

    return (
        <div className="tela" style={{ justifyContent: 'center' }}>
            <form onSubmit={aoEnviar} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ textAlign: 'center', marginBottom: 4 }}>
                    <h1 style={{ fontSize: 26 }}>WMS Boxer</h1>
                    <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '4px 0 0' }}>
                        Entre com seu e-mail e senha
                    </p>
                </div>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: 'var(--text-secondary)' }}>
                    E-mail
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        autoFocus
                        required
                    />
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: 'var(--text-secondary)' }}>
                    Senha
                    <input
                        type="password"
                        value={senha}
                        onChange={(e) => setSenha(e.target.value)}
                        required
                    />
                </label>

                {erro && (
                    <div className="badge danger" style={{ textAlign: 'center', padding: '8px 10px' }}>
                        {erro}
                    </div>
                )}

                <button type="submit" className="primary" disabled={entrando}>
                    {entrando ? 'Entrando...' : 'Entrar'}
                </button>
            </form>
        </div>
    );
}
