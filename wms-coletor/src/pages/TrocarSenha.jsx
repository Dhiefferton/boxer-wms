import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';

const estiloLabel = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: 'var(--text-secondary)' };

// obrigatorio=true: tela cheia, sem opção de cancelar - usada quando
// o colaborador está no primeiro acesso (senha definida pelo admin)
// e precisa trocar antes de ver qualquer outra tela do coletor.
// obrigatorio=false: modal por cima da tela atual, com "Cancelar" -
// troca de senha voluntária, aberta pelo ícone de cadeado no menu.
export default function TrocarSenha({ obrigatorio = false, aoFechar }) {
    const { trocarSenha } = useAuth();
    const [senhaAtual, setSenhaAtual] = useState('');
    const [novaSenha, setNovaSenha] = useState('');
    const [confirmacao, setConfirmacao] = useState('');
    const [erro, setErro] = useState(null);
    const [salvando, setSalvando] = useState(false);
    const [sucesso, setSucesso] = useState(false);

    async function aoEnviar(evento) {
        evento.preventDefault();
        setErro(null);

        if (novaSenha !== confirmacao) {
            setErro('As senhas novas não conferem');
            return;
        }

        setSalvando(true);
        try {
            await trocarSenha(senhaAtual, novaSenha);
            setSucesso(true);
            if (!obrigatorio) {
                setTimeout(() => aoFechar?.(), 900);
            }
        } catch (e) {
            setErro(e.message);
        } finally {
            setSalvando(false);
        }
    }

    const conteudo = (
        <form onSubmit={aoEnviar} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
                <h1 style={{ fontSize: 22 }}>Trocar senha</h1>
                {obrigatorio && (
                    <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '4px 0 0' }}>
                        Sua senha foi definida por um administrador. Defina uma senha só sua para continuar.
                    </p>
                )}
            </div>

            <label style={estiloLabel}>
                Senha atual
                <input
                    type="password"
                    value={senhaAtual}
                    onChange={(e) => setSenhaAtual(e.target.value)}
                    autoFocus
                    required
                />
            </label>

            <label style={estiloLabel}>
                Nova senha
                <input
                    type="password"
                    value={novaSenha}
                    onChange={(e) => setNovaSenha(e.target.value)}
                    minLength={6}
                    required
                />
            </label>

            <label style={estiloLabel}>
                Confirmar nova senha
                <input
                    type="password"
                    value={confirmacao}
                    onChange={(e) => setConfirmacao(e.target.value)}
                    minLength={6}
                    required
                />
            </label>

            {erro && (
                <div className="badge danger" style={{ textAlign: 'center', padding: '8px 10px' }}>
                    {erro}
                </div>
            )}
            {sucesso && (
                <div className="badge success" style={{ textAlign: 'center', padding: '8px 10px' }}>
                    Senha atualizada.
                </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="primary" disabled={salvando} style={{ flex: 1 }}>
                    {salvando ? 'Salvando...' : 'Salvar nova senha'}
                </button>
                {!obrigatorio && (
                    <button type="button" onClick={aoFechar}>
                        Cancelar
                    </button>
                )}
            </div>
        </form>
    );

    if (obrigatorio) {
        return <div className="tela" style={{ justifyContent: 'center' }}>{conteudo}</div>;
    }

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '1rem',
                zIndex: 1000,
            }}
            onClick={aoFechar}
        >
            <div style={{ width: '100%', maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
                {conteudo}
            </div>
        </div>
    );
}
