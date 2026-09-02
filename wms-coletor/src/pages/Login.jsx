import { useState } from 'react';
import { Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import logoBoxer from '../assets/logo-boxer.svg';

export default function Login() {
    const { entrar } = useAuth();
    const [email, setEmail] = useState('');
    const [senha, setSenha] = useState('');
    const [mostrarSenha, setMostrarSenha] = useState(false);
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
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <img src={logoBoxer} alt="Boxer" style={{ width: 56, height: 56 }} />
                <div style={{ textAlign: 'center' }}>
                    <h1 style={{ fontSize: 22 }}>Boxer WMS</h1>
                    <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '4px 0 0' }}>
                        Sistema de gestão de armazém
                    </p>
                </div>
            </div>

            <form onSubmit={aoEnviar} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <h2 style={{ fontSize: 16, margin: '0 0 4px' }}>Entrar na sua conta</h2>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: 'var(--text-secondary)' }}>
                    E-mail
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                        <Mail size={18} style={{ position: 'absolute', left: 12, color: 'var(--text-muted)' }} />
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            autoFocus
                            required
                            style={{ width: '100%', paddingLeft: 38 }}
                        />
                    </div>
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: 'var(--text-secondary)' }}>
                    Senha
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                        <Lock size={18} style={{ position: 'absolute', left: 12, color: 'var(--text-muted)' }} />
                        <input
                            type={mostrarSenha ? 'text' : 'password'}
                            value={senha}
                            onChange={(e) => setSenha(e.target.value)}
                            required
                            style={{ width: '100%', paddingLeft: 38, paddingRight: 44 }}
                        />
                        <button
                            type="button"
                            onClick={() => setMostrarSenha((v) => !v)}
                            title={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
                            style={{
                                position: 'absolute',
                                right: 4,
                                background: 'transparent',
                                border: 'none',
                                padding: 8,
                                minHeight: 'auto',
                                display: 'flex',
                                color: 'var(--text-muted)',
                            }}
                        >
                            {mostrarSenha ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                    </div>
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

            <p style={{ color: 'var(--text-secondary)', fontSize: 12, margin: 0, textAlign: 'center' }}>
                Problemas com acesso? Fale com o administrador.
            </p>
        </div>
    );
}
