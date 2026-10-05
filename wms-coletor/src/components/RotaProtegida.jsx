import { useAuth } from '../auth/AuthContext.jsx';

// Envolve uma rota que exige uma permissão (prop 'permissao', ex.: 'dash.mapa')
// ou, no formato antigo, um cargo especifico. 'admin' sempre passa. A API
// confere de novo - isto só evita mostrar uma tela que daria erro.
export default function RotaProtegida({ cargos, permissao, children }) {
    const { colaborador, pode } = useAuth();
    // 'permissao' (chave do catálogo, ou lista - basta ter uma) tem prioridade; 'cargos' fica só
    // por compatibilidade com telas que ainda não migraram.
    const permitido = permissao
        ? [].concat(permissao).some((chave) => pode(chave))
        : !cargos || cargos.length === 0 || colaborador.cargo === 'admin' || cargos.includes(colaborador.cargo);

    if (!permitido) {
        return (
            <div className="tela">
                <div className="card">
                    <h2 style={{ marginBottom: 8 }}>Acesso restrito</h2>
                    <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
                        Seu nível de acesso não permite ver esta tela. Fale com um administrador.
                    </p>
                </div>
            </div>
        );
    }

    return children;
}
