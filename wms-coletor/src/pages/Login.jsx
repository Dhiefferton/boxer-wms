import { useEffect, useRef, useState } from 'react';
import { Search, Lock, Eye, EyeOff } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext.jsx';
import logoBoxer from '../assets/logo-boxer.svg';

export default function Login() {
    const { entrar } = useAuth();
    const [busca, setBusca] = useState('');
    const [email, setEmail] = useState('');
    const [sugestoes, setSugestoes] = useState([]);
    const [mostrarSugestoes, setMostrarSugestoes] = useState(false);
    const [senha, setSenha] = useState('');
    const [mostrarSenha, setMostrarSenha] = useState(false);
    const [erro, setErro] = useState(null);
    const [entrando, setEntrando] = useState(false);

    // Evita que a busca dispare de novo logo depois de clicar numa
    // sugestão (o clique já muda `busca` pro nome escolhido, o que
    // acionaria o efeito de busca abaixo à toa).
    const ignorarProximaBuscaRef = useRef(false);

    // Busca por nome com debounce - só dispara com 2+ letras digitadas,
    // e pula a busca logo após selecionar uma sugestão (ver ref acima).
    useEffect(() => {
        if (ignorarProximaBuscaRef.current) {
            ignorarProximaBuscaRef.current = false;
            return;
        }
        const termo = busca.trim();
        if (termo.length < 2) {
            setSugestoes([]);
            setMostrarSugestoes(false);
            return;
        }
        const temporizador = setTimeout(async () => {
            try {
                const resultado = await api.get(`/auth/colaboradores-busca?q=${encodeURIComponent(termo)}`);
                setSugestoes(resultado);
                setMostrarSugestoes(resultado.length > 0);
            } catch {
                setSugestoes([]);
            }
        }, 300);
        return () => clearTimeout(temporizador);
    }, [busca]);

    function aoDigitarBusca(valor) {
        setBusca(valor);
        // Invalida a seleção anterior - só volta a valer um e-mail
        // depois que o usuário escolher (de novo) uma sugestão da lista.
        setEmail('');
    }

    function selecionarSugestao(sugestao) {
        ignorarProximaBuscaRef.current = true;
        setBusca(sugestao.nome);
        setEmail(sugestao.email);
        setSugestoes([]);
        setMostrarSugestoes(false);
    }

    async function aoEnviar(evento) {
        evento.preventDefault();
        setErro(null);

        if (!email) {
            setErro('Digite seu nome e escolha na lista de sugestões');
            return;
        }

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

                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: 'var(--text-secondary)', position: 'relative' }}>
                    Usuário
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                        <Search size={18} style={{ position: 'absolute', left: 12, color: 'var(--text-muted)' }} />
                        <input
                            // type="search" (em vez de "text") de propósito: assim o
                            // Chrome não trata esse campo como "usuário" de um form de
                            // login e não sobrepõe nossa lista de sugestões com o popup
                            // nativo do gerenciador de senhas.
                            type="search"
                            name="busca-colaborador"
                            value={busca}
                            onChange={(e) => aoDigitarBusca(e.target.value)}
                            onFocus={() => sugestoes.length > 0 && setMostrarSugestoes(true)}
                            onBlur={() => setTimeout(() => setMostrarSugestoes(false), 150)}
                            autoFocus
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="off"
                            spellCheck="false"
                            placeholder="Digite seu nome"
                            required
                            style={{ width: '100%', paddingLeft: 38 }}
                        />
                    </div>
                    {mostrarSugestoes && (
                        <ul
                            style={{
                                position: 'absolute',
                                top: '100%',
                                left: 0,
                                right: 0,
                                zIndex: 10,
                                marginTop: 4,
                                padding: 4,
                                listStyle: 'none',
                                background: 'var(--bg-card)',
                                border: '1px solid var(--border)',
                                borderRadius: 8,
                                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                                maxHeight: 200,
                                overflowY: 'auto',
                            }}
                        >
                            {sugestoes.map((s) => (
                                <li key={s.email}>
                                    <button
                                        type="button"
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={() => selecionarSugestao(s)}
                                        style={{
                                            width: '100%',
                                            textAlign: 'left',
                                            background: 'none',
                                            border: 'none',
                                            padding: '8px 10px',
                                            borderRadius: 6,
                                            font: 'inherit',
                                            color: 'var(--text-primary)',
                                            cursor: 'pointer',
                                        }}
                                    >
                                        {s.nome}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
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
